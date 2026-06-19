const crypto = require("crypto");

const Institution = Parse.Object.extend("Institution");
const Specialty = Parse.Object.extend("Specialty");
const UserInvitation = Parse.Object.extend("UserInvitation");

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

async function ensureEmailIsAvailable(email) {
  const existingUserQuery = new Parse.Query(Parse.User);
  existingUserQuery.matches("email", buildCaseInsensitiveRegex(email));
  existingUserQuery.limit(1);

  const existingUser = await existingUserQuery.first({ useMasterKey: true });

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

async function sendInvitationEmailStub(email, invitationUrl, displayName, invitationMessage) {
  console.log("Invitation email stub prepared.", {
    email,
    invitationUrl,
    displayName,
    invitationMessage,
  });

  return { delivered: true };
}

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
  const invitationUrl = `/accept-invitation.html?token=${encodeURIComponent(rawToken)}`;

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
    await sendInvitationEmailStub(email, invitationUrl, displayName, invitationMessage);
    savedInvitation.set("emailSentAt", new Date());
    savedInvitation.set("emailDeliveryStatus", "sent");
    await savedInvitation.save(null, { useMasterKey: true });
  } catch (error) {
    savedInvitation.set("emailDeliveryStatus", "failed");
    await savedInvitation.save(null, { useMasterKey: true });
    throw error;
  }

  return {
    success: true,
    invitationId: savedInvitation.id,
    email,
    displayName,
    roleName,
    tokenExpiresAt: tokenExpiresAt.toISOString(),
  };
});
