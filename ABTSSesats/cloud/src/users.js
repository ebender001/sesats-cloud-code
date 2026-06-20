const crypto = require("crypto");
const https = require("https");

const Institution = Parse.Object.extend("Institution");
const Specialty = Parse.Object.extend("Specialty");
const UserInvitation = Parse.Object.extend("UserInvitation");
const UserRoleAssignment = Parse.Object.extend("UserRoleAssignment");

const ALLOWED_ROLE_NAMES = new Set([
  "super_admin",
  "admin",
  "editor",
  "reviewer",
  "ai_generator",
  "subscriber",
  "institution_admin",
]);

const ALLOWED_CREDENTIALS = new Set(["MD", "DO", "PhD", "PA", "NP", "RN", "Other"]);
const INVITATION_EXPIRATION_DAYS = 30;
const RESEND_API_URL = "https://api.resend.com/emails";
// TODO: Replace this with the real deployed website domain that serves accept-invitation.html.
// For local testing, use localhost until a production domain is available.
const INVITATION_ACCEPT_BASE_URL = "http://localhost:8000";

function requireString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${fieldName} is required.`);
  }

  return value.trim();
}

function normalizeOptionalString(value, fieldName) {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${fieldName} must be a string.`);
  }

  return value.trim();
}

function normalizeEmail(value) {
  const email = requireString(value, "email").toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(email)) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, "A valid email address is required.");
  }

  return email;
}

function requireAllowedValue(value, fieldName, allowedValues) {
  const normalizedValue = requireString(value, fieldName);

  if (!allowedValues.has(normalizedValue)) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${fieldName} is invalid.`);
  }

  return normalizedValue;
}

function requireObjectId(value, fieldName) {
  const objectId = requireString(value, fieldName);

  if (!/^[A-Za-z0-9]{10,}$/.test(objectId)) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${fieldName} is invalid.`);
  }

  return objectId;
}

function buildCaseInsensitiveRegex(value) {
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escapedValue}$`, "i");
}

function getRoleDisplayName(roleName) {
  const roleDisplayNames = {
    super_admin: "Super Admin",
    admin: "Administrator",
    editor: "Editor",
    reviewer: "Reviewer",
    ai_generator: "AI Generator",
    subscriber: "Subscriber",
    institution_admin: "Institution Administrator",
  };

  return roleDisplayNames[roleName] || roleName;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[character] || character;
  });
}

function formatDateForDisplay(value) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  return `${monthNames[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function buildInvitationUrl(rawToken) {
  return `${INVITATION_ACCEPT_BASE_URL}/accept-invitation.html?token=${encodeURIComponent(rawToken)}`;
}

function getInvitationGreetingName(invitation) {
  const storedDisplayName = normalizeOptionalString(invitation?.get("displayName"), "displayName");

  if (storedDisplayName) {
    return storedDisplayName;
  }

  const storedEmail = normalizeOptionalString(invitation?.get("email"), "email");
  return storedEmail ? storedEmail.split("@")[0] : "there";
}

function appendNotes(existingNotes, appendedMessage) {
  const sanitizedExistingNotes = normalizeOptionalString(existingNotes, "notes");
  const sanitizedMessage = normalizeOptionalString(appendedMessage, "notes");

  if (!sanitizedMessage) {
    return sanitizedExistingNotes;
  }

  if (!sanitizedExistingNotes) {
    return sanitizedMessage;
  }

  return `${sanitizedExistingNotes}\n${sanitizedMessage}`;
}

async function requireAuthenticatedUser(request) {
  if (!request.user) {
    throw new Parse.Error(Parse.Error.SESSION_MISSING, "You must be logged in to invite users.");
  }

  return request.user;
}

async function requireAdminAccess(user) {
  const roleQuery = new Parse.Query(Parse.Role);
  roleQuery.containedIn("name", ["super_admin", "admin"]);
  roleQuery.equalTo("users", user);
  roleQuery.limit(1);

  const authorizedRole = await roleQuery.first({ useMasterKey: true });

  if (!authorizedRole) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      "Only super_admin or admin users can send invitations."
    );
  }
}

async function requireActiveInstitution(objectId) {
  const query = new Parse.Query(Institution);
  query.equalTo("objectId", objectId);
  query.equalTo("isActive", true);

  const institution = await query.first({ useMasterKey: true });
  if (!institution) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, "Selected institution is invalid.");
  }

  return institution;
}

async function requireActiveSpecialty(objectId) {
  const query = new Parse.Query(Specialty);
  query.equalTo("objectId", objectId);
  query.equalTo("isActive", true);

  const specialty = await query.first({ useMasterKey: true });
  if (!specialty) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, "Selected specialty is invalid.");
  }

  return specialty;
}

async function findExistingUserByEmail(email) {
  const query = new Parse.Query(Parse.User);
  query.matches("email", buildCaseInsensitiveRegex(email));
  query.limit(1);
  return query.first({ useMasterKey: true });
}

async function findExistingUserByUsername(username) {
  const query = new Parse.Query(Parse.User);
  query.matches("username", buildCaseInsensitiveRegex(username));
  query.limit(1);
  return query.first({ useMasterKey: true });
}

async function ensureEmailIsAvailable(email) {
  const existingUser = await findExistingUserByEmail(email);

  if (existingUser) {
    throw new Parse.Error(
      Parse.Error.VALIDATION_ERROR,
      "A user with this email address already exists."
    );
  }

  const pendingInvitationQuery = new Parse.Query(UserInvitation);
  pendingInvitationQuery.matches("email", buildCaseInsensitiveRegex(email));
  pendingInvitationQuery.equalTo("status", "pending");
  pendingInvitationQuery.limit(1);

  const pendingInvitation = await pendingInvitationQuery.first({ useMasterKey: true });

  if (pendingInvitation) {
    throw new Parse.Error(
      Parse.Error.VALIDATION_ERROR,
      "A pending invitation already exists for this email address."
    );
  }
}

async function ensureNoExistingUserForEmail(email) {
  const existingUser = await findExistingUserByEmail(email);

  if (existingUser) {
    throw new Parse.Error(
      Parse.Error.VALIDATION_ERROR,
      "A user with this email address already exists."
    );
  }
}

async function ensureUsernameIsAvailable(username) {
  const existingUser = await findExistingUserByUsername(username);

  if (existingUser) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, "That username is already taken.");
  }
}

async function requireRoleByName(roleName) {
  const roleQuery = new Parse.Query(Parse.Role);
  roleQuery.limit(1000);

  roleQuery.equalTo("name", roleName);
  const role = await roleQuery.first({ useMasterKey: true });
  if (!role) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, "The requested role could not be found.");
  }

  return role;
}

function generateInvitationToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashInvitationToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function buildExpirationDate() {
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + INVITATION_EXPIRATION_DAYS);
  return expirationDate;
}

function requireResendApiKey() {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      "RESEND_API_KEY is not configured in the Back4App environment."
    );
  }

  return apiKey;
}

function requireResendFromEmail() {
  const fromEmail = process.env.RESEND_FROM_EMAIL || process.env.SESATS_INVITATION_FROM_EMAIL;

  if (!fromEmail || typeof fromEmail !== "string" || fromEmail.trim().length === 0) {
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      "RESEND_FROM_EMAIL or SESATS_INVITATION_FROM_EMAIL must be configured in the Back4App environment."
    );
  }

  return fromEmail.trim();
}

function postJson(url, headers, payload) {
  if (typeof fetch === "function") {
    return fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    }).then(async (response) => ({
      status: response.status,
      data: await response.text(),
    }));
  }

  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "POST",
        headers,
      },
      (response) => {
        let responseBody = "";

        response.on("data", (chunk) => {
          responseBody += chunk;
        });

        response.on("end", () => {
          resolve({
            status: response.statusCode || 0,
            data: responseBody,
          });
        });
      }
    );

    request.on("error", reject);
    request.write(JSON.stringify(payload));
    request.end();
  });
}

async function sendInvitationEmail({
  invitation,
  email,
  roleName,
  invitationUrl,
  tokenExpiresAt,
  invitationMessage,
}) {
  const resendApiKey = requireResendApiKey();
  const resendFromEmail = requireResendFromEmail();
  const roleDisplayName = getRoleDisplayName(roleName);
  const expirationDate = formatDateForDisplay(tokenExpiresAt);
  const greetingName = getInvitationGreetingName(invitation);
  const invitationMessageHtml = escapeHtml(invitationMessage).replace(/\n/g, "<br />");
  const messageSection = invitationMessage
    ? `
      <p style="margin: 0 0 18px; color: #08285c; line-height: 1.7;">
        <strong>Invitation message:</strong><br />
        ${invitationMessageHtml}
      </p>
    `
    : "";

  const html = `
    <div style="background: #f7f9fd; padding: 32px 18px; font-family: Arial, sans-serif; color: #08285c;">
      <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 20px; box-shadow: 0 18px 50px rgba(0, 40, 95, 0.08); overflow: hidden;">
        <div style="padding: 24px 28px; background: linear-gradient(135deg, #00285f, #001d47); color: #ffffff;">
          <h1 style="margin: 0; font-size: 24px;">SESATS Invitation</h1>
        </div>
        <div style="padding: 28px;">
          <p style="margin: 0 0 18px; line-height: 1.7;">Dear ${escapeHtml(greetingName)},</p>
          <p style="margin: 0 0 18px; line-height: 1.7;">
            Please accept this invitation as a(n) ${escapeHtml(roleDisplayName)} for the SESATS Administration platform.
          </p>
          <p style="margin: 0 0 18px; line-height: 1.7;">
            You have been invited to create an account. To accept the invitation, click the link below and choose your username and password.
          </p>
          ${messageSection}
          <p style="margin: 28px 0;">
            <a
              href="${escapeHtml(invitationUrl)}"
              style="display: inline-block; padding: 14px 22px; border-radius: 999px; background: #174b93; color: #ffffff; text-decoration: none; font-weight: 700;"
            >Accept Invitation</a>
          </p>
          <p style="margin: 0 0 18px; line-height: 1.7;">
            If the button above does not work, use this link:<br />
            <a href="${escapeHtml(invitationUrl)}" style="color: #174b93; word-break: break-word;">${escapeHtml(invitationUrl)}</a>
          </p>
          <p style="margin: 0 0 18px; line-height: 1.7;">This invitation will expire on ${escapeHtml(expirationDate)}.</p>
          <p style="margin: 0 0 18px; line-height: 1.7;">
            If you were not expecting this invitation, you may ignore this email.
          </p>
          <p style="margin: 0; line-height: 1.7;">SESATS Administration</p>
        </div>
      </div>
    </div>
  `;

  const text = [
    `Dear ${greetingName},`,
    "",
    `Please accept this invitation as a(n) ${roleDisplayName} for the SESATS Administration platform.`,
    "",
    "You have been invited to create an account. To accept the invitation, click the link below and choose your username and password.",
    "",
    invitationUrl,
    "",
    invitationMessage ? `Invitation message: ${invitationMessage}` : "",
    invitationMessage ? "" : null,
    `This invitation will expire on ${expirationDate}.`,
    "",
    "If you were not expecting this invitation, you may ignore this email.",
    "",
    "SESATS Administration",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const response = await postJson(
    RESEND_API_URL,
    {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    {
      from: resendFromEmail,
      to: [email],
      subject: "SESATS Invitation",
      html,
      text,
    }
  );

  if (!response || response.status < 200 || response.status >= 300) {
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      `Resend did not accept the invitation email request.${response?.data ? ` ${response.data}` : ""}`
    );
  }

  return response;
}

async function requirePendingInvitationByToken(token) {
  const tokenHash = hashInvitationToken(requireString(token, "token"));
  const now = new Date();
  const query = new Parse.Query(UserInvitation);
  query.equalTo("tokenHash", tokenHash);
  query.equalTo("status", "pending");
  query.greaterThan("tokenExpiresAt", now);
  query.include("institution", "primarySpecialty", "invitedBy");
  query.limit(1);

  const invitation = await query.first({ useMasterKey: true });

  if (!invitation) {
    throw new Parse.Error(
      Parse.Error.OBJECT_NOT_FOUND,
      "This invitation is invalid, expired, or has already been accepted."
    );
  }

  return invitation;
}

Parse.Cloud.define("listUsers", async (request) => {
  const user = await requireAuthenticatedUser(request);
  await requireAdminAccess(user);

  const query = new Parse.Query(Parse.User);
  query.include("institution", "primarySpecialty");
  query.ascending("displayName", "username");
  query.limit(1000);

  const users = await query.find({ useMasterKey: true });

  return users.map((listedUser) => {
    const institution = listedUser.get("institution");
    const specialty = listedUser.get("primarySpecialty");

    return {
      objectId: listedUser.id,
      displayName: listedUser.get("displayName") || listedUser.get("username") || "",
      credentials: listedUser.get("credentials") || "",
      institutionName: institution?.get("name") || "",
      specialtyName: specialty?.get("name") || "",
    };
  });
});

Parse.Cloud.define("inviteUser", async (request) => {
  const user = await requireAuthenticatedUser(request);
  await requireAdminAccess(user);

  const params = request.params || {};
  const email = normalizeEmail(params.email);
  const displayName = requireString(params.displayName, "displayName");
  const credentials = requireAllowedValue(params.credentials, "credentials", ALLOWED_CREDENTIALS);
  const institutionId = requireObjectId(params.institutionId, "institutionId");
  const primarySpecialtyId = requireObjectId(params.primarySpecialtyId, "primarySpecialtyId");
  const roleName = requireAllowedValue(params.roleName, "roleName", ALLOWED_ROLE_NAMES);
  const invitationMessage = normalizeOptionalString(
    params.invitationMessage,
    "invitationMessage"
  );
  const notes = normalizeOptionalString(params.notes, "notes");

  const [institution, specialty] = await Promise.all([
    requireActiveInstitution(institutionId),
    requireActiveSpecialty(primarySpecialtyId),
  ]);

  await ensureEmailIsAvailable(email);

  const rawToken = generateInvitationToken();
  const now = new Date();
  const tokenExpiresAt = buildExpirationDate();
  const invitationUrl = buildInvitationUrl(rawToken);
  const roleDisplayName = getRoleDisplayName(roleName);

  const invitation = new UserInvitation();
  invitation.set("email", email);
  invitation.set("displayName", displayName);
  invitation.set("credentials", credentials);
  invitation.set("institution", institution);
  invitation.set("primarySpecialty", specialty);
  invitation.set("roleName", roleName);
  invitation.set("editorStatus", "pending");
  invitation.set("invitedBy", user);
  invitation.set("invitedAt", now);
  invitation.set("tokenHash", hashInvitationToken(rawToken));
  invitation.set("tokenExpiresAt", tokenExpiresAt);
  invitation.set("status", "pending");
  invitation.set("invitationMessage", invitationMessage);
  invitation.set("emailDeliveryStatus", "pending");
  invitation.set("notes", notes);

  const savedInvitation = await invitation.save(null, { useMasterKey: true });

  try {
    await sendInvitationEmail({
      invitation: savedInvitation,
      email,
      roleName,
      invitationUrl,
      tokenExpiresAt,
      invitationMessage,
    });

    savedInvitation.set("emailSentAt", new Date());
    savedInvitation.set("emailDeliveryStatus", "sent");
    await savedInvitation.save(null, { useMasterKey: true });
  } catch (error) {
    savedInvitation.set("emailDeliveryStatus", "failed");
    savedInvitation.set(
      "notes",
      appendNotes(savedInvitation.get("notes"), `Email send error: ${error.message || error}`)
    );
    await savedInvitation.save(null, { useMasterKey: true });
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      error?.message || "Unable to send the invitation email."
    );
  }

  return {
    success: true,
    invitationId: savedInvitation.id,
    email,
    displayName,
    roleName,
    roleDisplayName,
    tokenExpiresAt: tokenExpiresAt.toISOString(),
    emailDeliveryStatus: savedInvitation.get("emailDeliveryStatus") || "sent",
  };
});

Parse.Cloud.define("acceptInvitation", async (request) => {
  const params = request.params || {};
  const token = requireString(params.token, "token");
  const username = requireString(params.username, "username");
  const password = requireString(params.password, "password");

  if (password.length < 8) {
    throw new Parse.Error(
      Parse.Error.VALIDATION_ERROR,
      "Password must be at least 8 characters long."
    );
  }

  const invitation = await requirePendingInvitationByToken(token);
  const email = normalizeEmail(invitation.get("email"));

  await Promise.all([ensureUsernameIsAvailable(username), ensureNoExistingUserForEmail(email)]);

  const roleName = requireAllowedValue(invitation.get("roleName"), "roleName", ALLOWED_ROLE_NAMES);
  const role = await requireRoleByName(roleName);
  const now = new Date();

  const user = new Parse.User();
  user.set("username", username);
  user.set("password", password);
  user.set("email", email);
  user.set("emailVerified", true);
  user.set("displayName", invitation.get("displayName") || "");
  user.set("credentials", invitation.get("credentials") || "");
  user.set("editorStatus", "active");
  user.set("institution", invitation.get("institution") || null);
  user.set("primarySpecialty", invitation.get("primarySpecialty") || null);
  user.set("profileCompleted", true);
  user.set("isActive", true);

  const savedUser = await user.save(null, { useMasterKey: true });

  const userRoleAssignment = new UserRoleAssignment();
  userRoleAssignment.set("user", savedUser);
  userRoleAssignment.set("roleName", roleName);
  userRoleAssignment.set("institution", invitation.get("institution") || null);
  userRoleAssignment.set("specialty", invitation.get("primarySpecialty") || null);
  userRoleAssignment.set("assignedBy", invitation.get("invitedBy") || null);
  userRoleAssignment.set("assignedAt", now);
  userRoleAssignment.set("isActive", true);

  const roleUsers = role.getUsers();
  roleUsers.add(savedUser);

  invitation.set("status", "accepted");
  invitation.set("acceptedBy", savedUser);
  invitation.set("acceptedAt", now);

  await userRoleAssignment.save(null, { useMasterKey: true });
  await role.save(null, { useMasterKey: true });
  await invitation.save(null, { useMasterKey: true });

  return {
    success: true,
    displayName: savedUser.get("displayName") || "",
    email,
    roleName,
  };
});
