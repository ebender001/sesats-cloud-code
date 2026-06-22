const Question = Parse.Object.extend("Question");
const QuestionOption = Parse.Object.extend("QuestionOption");
const QuestionMedia = Parse.Object.extend("QuestionMedia");
const Reference = Parse.Object.extend("Reference");
const QuestionReference = Parse.Object.extend("QuestionReference");
const ParseUser = Parse.User;
const crypto = require("crypto");
const https = require("https");

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_REFERENCE_PARSER_MODEL = "gpt-4.1-mini";
const ALLOWED_MEDIA_TYPES = new Set(["IMAGE", "VIDEO"]);
const ALLOWED_MEDIA_PLACEMENTS = new Set(["QUESTION", "CRITIQUE"]);

function requireString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${fieldName} is required.`);
  }

  return value.trim();
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, "Optional fields must be strings.");
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function normalizeOptionalBoolean(value, fieldName) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${fieldName} must be a boolean.`);
  }

  return value;
}

function normalizeOptionalDate(value, fieldName) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${fieldName} must be a valid date.`);
  }

  return date;
}

function normalizeOptionalNumber(value, fieldName) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${fieldName} must be a number.`);
  }

  return value;
}

function requireAuthenticatedUser(request) {
  if (!request.user) {
    throw new Parse.Error(Parse.Error.SESSION_MISSING, "Authentication required.");
  }

  return request.user;
}

function requireObjectId(value, fieldName) {
  const objectId = requireString(value, fieldName);

  if (!/^[A-Za-z0-9]{10,}$/.test(objectId)) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${fieldName} is invalid.`);
  }

  return objectId;
}

function requireAllowedValue(value, fieldName, allowedValues) {
  const normalizedValue = requireString(value, fieldName).toUpperCase();

  if (!allowedValues.has(normalizedValue)) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${fieldName} is invalid.`);
  }

  return normalizedValue;
}

function requireR2Config() {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const accountId = process.env.R2_ACCOUNT_ID;
  const bucketName = process.env.R2_BUCKET_NAME;
  const endpoint = process.env.R2_ENDPOINT;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accessKeyId || !accountId || !bucketName || !endpoint || !secretAccessKey) {
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      "Cloudflare R2 environment variables are not fully configured."
    );
  }

  return {
    accessKeyId: accessKeyId.trim(),
    accountId: accountId.trim(),
    bucketName: bucketName.trim(),
    endpoint: endpoint.trim(),
    secretAccessKey: secretAccessKey.trim(),
  };
}

function buildPublicUrl(endpoint, bucketName, key) {
  const normalizedEndpoint = String(endpoint || "").replace(/\/+$/, "");
  const normalizedBucket = String(bucketName || "").replace(/^\/+|\/+$/g, "");
  const normalizedKey = String(key || "").replace(/^\/+/, "");

  if (!normalizedEndpoint || !normalizedBucket || !normalizedKey) {
    return "";
  }

  const endpointAlreadyIncludesBucket =
    normalizedEndpoint === normalizedBucket ||
    normalizedEndpoint.endsWith(`/${normalizedBucket}`) ||
    normalizedEndpoint.includes(`://${normalizedBucket}.`);

  return endpointAlreadyIncludesBucket
    ? `${normalizedEndpoint}/${normalizedKey}`
    : `${normalizedEndpoint}/${normalizedBucket}/${normalizedKey}`;
}

function sanitizeFileName(fileName) {
  const normalizedName = requireString(fileName, "fileName")
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return normalizedName || "upload";
}

function decodeBase64File(base64Data) {
  const normalizedData = requireString(base64Data, "base64Data");
  const payload = normalizedData.includes(",") ? normalizedData.split(",").pop() : normalizedData;

  if (!payload || !/^[A-Za-z0-9+/=\s]+$/.test(payload)) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, "base64Data is invalid.");
  }

  return Buffer.from(payload.replace(/\s+/g, ""), "base64");
}

function buildQuestionMediaKey(questionId, placement, mediaType, fileName) {
  const timestamp = Date.now();
  const randomSegment = Math.random().toString(36).slice(2, 10);
  const safeFileName = sanitizeFileName(fileName);

  return `questions/${questionId}/${placement.toLowerCase()}/${mediaType.toLowerCase()}/${timestamp}-${randomSegment}-${safeFileName}`;
}

function encodeRfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmacSha256(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function getAwsSignatureDates(date = new Date()) {
  const isoString = date.toISOString().replace(/[:-]|\.\d{3}/g, "");

  return {
    amzDate: isoString,
    dateStamp: isoString.slice(0, 8),
  };
}

function buildR2ObjectUrl(endpoint, bucketName, key) {
  const url = new URL(requireString(endpoint, "R2_ENDPOINT"));
  const normalizedBucket = requireString(bucketName, "R2_BUCKET_NAME");
  const normalizedKey = String(key || "").replace(/^\/+/, "");

  if (!normalizedKey) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, "fileKey is required.");
  }

  const pathSegments = url.pathname.split("/").filter(Boolean);
  const endpointIncludesBucket =
    pathSegments[pathSegments.length - 1] === normalizedBucket ||
    url.hostname.startsWith(`${normalizedBucket}.`);

  const baseSegments = endpointIncludesBucket ? pathSegments : [...pathSegments, normalizedBucket];
  const keySegments = normalizedKey.split("/").filter(Boolean).map(encodeRfc3986);

  url.pathname = `/${[...baseSegments.map(encodeRfc3986), ...keySegments].join("/")}`;
  url.search = "";

  return url;
}

async function putObjectToR2({ endpoint, bucketName, accessKeyId, secretAccessKey, key, body, contentType }) {
  const targetUrl = buildR2ObjectUrl(endpoint, bucketName, key);
  const { amzDate, dateStamp } = getAwsSignatureDates();
  const payloadHash = sha256Hex(body);
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${targetUrl.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
  ].join("\n");
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    targetUrl.pathname,
    "",
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, "auto");
  const kService = hmacSha256(kRegion, "s3");
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = hmacSha256(kSigning, stringToSign, "hex");
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  await new Promise((resolve, reject) => {
    const request = https.request(
      targetUrl,
      {
        method: "PUT",
        headers: {
          Authorization: authorization,
          "Content-Length": body.length,
          "Content-Type": contentType,
          Host: targetUrl.host,
          "X-Amz-Content-Sha256": payloadHash,
          "X-Amz-Date": amzDate,
        },
      },
      (response) => {
        let responseBody = "";

        response.on("data", (chunk) => {
          responseBody += chunk;
        });

        response.on("end", () => {
          if ((response.statusCode || 500) >= 200 && (response.statusCode || 500) < 300) {
            resolve();
            return;
          }

          reject(
            new Parse.Error(
              Parse.Error.SCRIPT_FAILED,
              `R2 upload failed with status ${response.statusCode || 500}: ${responseBody || "Unknown error."}`
            )
          );
        });
      }
    );

    request.on("error", (error) => {
      reject(
        new Parse.Error(
          Parse.Error.SCRIPT_FAILED,
          `Unable to upload media to R2: ${error?.message || "Unknown error."}`
        )
      );
    });

    request.write(body);
    request.end();
  });
}

function requireOpenAiApiKey() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      "OPENAI_API_KEY is not configured in the Back4App environment."
    );
  }

  return apiKey.trim();
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

function normalizeParsedReferenceField(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeParsedReferenceYear(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  const numericValue = Number.parseInt(String(value).trim(), 10);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function normalizeParsedReferencePmid(value) {
  return normalizeParsedReferenceField(value).replace(/\D+/g, "");
}

function normalizeParsedReferenceDoi(value) {
  return normalizeParsedReferenceField(value)
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .trim();
}

function normalizeParsedReference(rawReference, originalCitationText) {
  const safeReference =
    rawReference && typeof rawReference === "object" && !Array.isArray(rawReference)
      ? rawReference
      : {};

  return {
    title: normalizeParsedReferenceField(safeReference.title),
    authors: normalizeParsedReferenceField(safeReference.authors),
    journal: normalizeParsedReferenceField(safeReference.journal),
    year: normalizeParsedReferenceYear(safeReference.year),
    volume: normalizeParsedReferenceField(safeReference.volume),
    issue: normalizeParsedReferenceField(safeReference.issue),
    pages: normalizeParsedReferenceField(safeReference.pages),
    pmid: normalizeParsedReferencePmid(safeReference.pmid),
    doi: normalizeParsedReferenceDoi(safeReference.doi),
    url: normalizeParsedReferenceField(safeReference.url),
    citationText:
      normalizeParsedReferenceField(safeReference.citationText) ||
      normalizeParsedReferenceField(originalCitationText),
    note: normalizeParsedReferenceField(safeReference.note),
  };
}

function extractOpenAiMessageContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }

  return "";
}

function setUserPointer(question, fieldName, objectId) {
  if (objectId === null || objectId === "") {
    question.unset(fieldName);
    return;
  }

  const user = new ParseUser();
  user.id = requireString(objectId, `${fieldName}ObjectId`);
  question.set(fieldName, user);
}

function applyQuestionFields(question, params, { requireStem = false } = {}) {
  if (requireStem || Object.prototype.hasOwnProperty.call(params, "stem")) {
    question.set("stem", requireString(params.stem, "stem"));
  }

  const optionalStringFields = [
    "explanation",
    "critique",
    "difficulty",
    "specialty",
    "topic",
    "status",
    "aiModel",
    "aiPromptVersion",
  ];

  optionalStringFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(params, field)) {
      question.set(field, normalizeOptionalString(params[field]));
    }
  });

  if (Object.prototype.hasOwnProperty.call(params, "generatedByAI")) {
    question.set(
      "generatedByAI",
      normalizeOptionalBoolean(params.generatedByAI, "generatedByAI")
    );
  }

  if (Object.prototype.hasOwnProperty.call(params, "createdByObjectId")) {
    setUserPointer(question, "createdBy", params.createdByObjectId);
  }

  if (Object.prototype.hasOwnProperty.call(params, "approvedByObjectId")) {
    setUserPointer(question, "approvedBy", params.approvedByObjectId);
  }

  if (Object.prototype.hasOwnProperty.call(params, "lastEditedByObjectId")) {
    setUserPointer(question, "lastEditedBy", params.lastEditedByObjectId);
  }

  if (Object.prototype.hasOwnProperty.call(params, "approvedAt")) {
    const approvedAt = normalizeOptionalDate(params.approvedAt, "approvedAt");
    if (approvedAt === undefined) {
      question.unset("approvedAt");
    } else {
      question.set("approvedAt", approvedAt);
    }
  }

  if (Object.prototype.hasOwnProperty.call(params, "lastEditedAt")) {
    const lastEditedAt = normalizeOptionalDate(params.lastEditedAt, "lastEditedAt");
    if (lastEditedAt === undefined) {
      question.unset("lastEditedAt");
    } else {
      question.set("lastEditedAt", lastEditedAt);
    }
  }
}

function serializePointer(pointer) {
  return pointer ? pointer.id : "";
}

function serializeDate(date) {
  return date instanceof Date ? date.toISOString() : "";
}

function serializeQuestion(question) {
  return {
    objectId: question.id,
    stem: question.get("stem") || "",
    explanation: question.get("explanation") || "",
    critique: question.get("critique") || "",
    difficulty: question.get("difficulty") || "",
    specialty: question.get("specialty") || "",
    topic: question.get("topic") || "",
    status: question.get("status") || "",
    generatedByAI: question.get("generatedByAI"),
    aiModel: question.get("aiModel") || "",
    aiPromptVersion: question.get("aiPromptVersion") || "",
    createdByObjectId: serializePointer(question.get("createdBy")),
    approvedByObjectId: serializePointer(question.get("approvedBy")),
    approvedAt: serializeDate(question.get("approvedAt")),
    lastEditedByObjectId: serializePointer(question.get("lastEditedBy")),
    lastEditedAt: serializeDate(question.get("lastEditedAt")),
    createdAt: serializeDate(question.createdAt),
    updatedAt: serializeDate(question.updatedAt),
  };
}

async function fetchQuestionOptionsByQuestionIds(questionIds) {
  if (!questionIds.length) {
    return new Map();
  }

  const questionPointers = questionIds.map((questionId) => {
    const question = new Question();
    question.id = questionId;
    return question;
  });

  const query = new Parse.Query(QuestionOption);
  query.containedIn("question", questionPointers);
  query.ascending("sortOrder");
  query.ascending("label");
  query.limit(1000);

  const options = await query.find({ useMasterKey: true });
  const optionsByQuestionId = new Map();

  options.forEach((option) => {
    const questionPointer = option.get("question");
    const questionId = questionPointer ? questionPointer.id : "";

    if (!optionsByQuestionId.has(questionId)) {
      optionsByQuestionId.set(questionId, []);
    }

    optionsByQuestionId.get(questionId).push(serializeQuestionOption(option));
  });

  return optionsByQuestionId;
}

async function serializeQuestionWithOptions(question) {
  const serializedQuestion = serializeQuestion(question);
  const optionsByQuestionId = await fetchQuestionOptionsByQuestionIds([question.id]);

  return {
    ...serializedQuestion,
    questionOptions: optionsByQuestionId.get(question.id) || [],
  };
}

async function serializeQuestionsWithOptions(questions) {
  const serializedQuestions = questions.map(serializeQuestion);
  const optionsByQuestionId = await fetchQuestionOptionsByQuestionIds(
    questions.map((question) => question.id)
  );

  return serializedQuestions.map((question) => ({
    ...question,
    questionOptions: optionsByQuestionId.get(question.objectId) || [],
  }));
}

function setQuestionPointer(option, questionObjectId) {
  if (questionObjectId === null || questionObjectId === "") {
    option.unset("question");
    return;
  }

  const question = new Question();
  question.id = requireString(questionObjectId, "questionObjectId");
  option.set("question", question);
}

function applyQuestionOptionFields(
  option,
  params,
  { requireQuestion = false, requireLabel = false, requireText = false } = {}
) {
  if (requireQuestion || Object.prototype.hasOwnProperty.call(params, "questionObjectId")) {
    setQuestionPointer(option, params.questionObjectId);
  }

  if (requireLabel || Object.prototype.hasOwnProperty.call(params, "label")) {
    option.set("label", requireString(params.label, "label"));
  }

  if (requireText || Object.prototype.hasOwnProperty.call(params, "text")) {
    option.set("text", requireString(params.text, "text"));
  }

  if (Object.prototype.hasOwnProperty.call(params, "isCorrect")) {
    option.set("isCorrect", normalizeOptionalBoolean(params.isCorrect, "isCorrect"));
  }

  if (Object.prototype.hasOwnProperty.call(params, "sortOrder")) {
    option.set("sortOrder", normalizeOptionalNumber(params.sortOrder, "sortOrder"));
  }
}

function applyReferenceFields(reference, params) {
  const optionalStringFields = [
    "title",
    "authors",
    "journal",
    "volume",
    "issue",
    "pages",
    "doi",
    "pmid",
    "url",
    "citationText",
    "abstract",
  ];

  optionalStringFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(params, field)) {
      reference.set(field, normalizeOptionalString(params[field]));
    }
  });

  if (Object.prototype.hasOwnProperty.call(params, "isActive")) {
    reference.set("isActive", normalizeOptionalBoolean(params.isActive, "isActive"));
  }

  if (Object.prototype.hasOwnProperty.call(params, "year")) {
    const year = normalizeOptionalNumber(params.year, "year");
    if (year === undefined) {
      reference.unset("year");
    } else {
      reference.set("year", year);
    }
  }
}

function setReferencePointer(questionReference, referenceObjectId) {
  if (referenceObjectId === null || referenceObjectId === "") {
    questionReference.unset("reference");
    return;
  }

  const reference = new Reference();
  reference.id = requireString(referenceObjectId, "referenceObjectId");
  questionReference.set("reference", reference);
}

function applyQuestionReferenceFields(questionReference, params, { requireQuestion = false, requireReference = false } = {}) {
  if (requireQuestion || Object.prototype.hasOwnProperty.call(params, "questionObjectId")) {
    setQuestionPointer(questionReference, params.questionObjectId);
  }

  if (requireReference || Object.prototype.hasOwnProperty.call(params, "referenceObjectId")) {
    setReferencePointer(questionReference, params.referenceObjectId);
  }

  if (Object.prototype.hasOwnProperty.call(params, "sortOrder")) {
    questionReference.set("sortOrder", normalizeOptionalNumber(params.sortOrder, "sortOrder"));
  }

  if (Object.prototype.hasOwnProperty.call(params, "isPrimary")) {
    questionReference.set("isPrimary", normalizeOptionalBoolean(params.isPrimary, "isPrimary"));
  }

  if (Object.prototype.hasOwnProperty.call(params, "note")) {
    questionReference.set("note", normalizeOptionalString(params.note));
  }
}

function serializeQuestionOption(option) {
  return {
    objectId: option.id,
    questionObjectId: serializePointer(option.get("question")),
    label: option.get("label") || "",
    text: option.get("text") || "",
    isCorrect: option.get("isCorrect"),
    sortOrder: option.get("sortOrder"),
    createdAt: serializeDate(option.createdAt),
    updatedAt: serializeDate(option.updatedAt),
  };
}

Parse.Cloud.define("addQuestion", async (request) => {
  const question = new Question();
  applyQuestionFields(question, request.params || {}, { requireStem: true });

  const savedQuestion = await question.save(null, { useMasterKey: true });
  return serializeQuestionWithOptions(savedQuestion);
});

Parse.Cloud.define("getQuestion", async (request) => {
  const objectId = requireString(request.params.objectId, "objectId");
  const query = new Parse.Query(Question);
  const question = await query.get(objectId, { useMasterKey: true });

  return serializeQuestionWithOptions(question);
});

Parse.Cloud.define("editQuestion", async (request) => {
  const objectId = requireString(request.params.objectId, "objectId");
  const query = new Parse.Query(Question);
  const question = await query.get(objectId, { useMasterKey: true });

  applyQuestionFields(question, request.params || {});

  const savedQuestion = await question.save(null, { useMasterKey: true });
  return serializeQuestionWithOptions(savedQuestion);
});

Parse.Cloud.define("deleteQuestion", async (request) => {
  const objectId = requireString(request.params.objectId, "objectId");
  const query = new Parse.Query(Question);
  const question = await query.get(objectId, { useMasterKey: true });

  await question.destroy({ useMasterKey: true });

  return {
    objectId,
    deleted: true,
  };
});

Parse.Cloud.define("listQuestions", async () => {
  const query = new Parse.Query(Question);

  query.descending("updatedAt");
  query.limit(1000);

  const questions = await query.find({ useMasterKey: true });
  return serializeQuestionsWithOptions(questions);
});

Parse.Cloud.define("parseReferenceCitation", async (request) => {
  const citationText = requireString(request.params?.citationText, "citationText");
  const apiKey = requireOpenAiApiKey();

  const payload = {
    model: OPENAI_REFERENCE_PARSER_MODEL,
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "parsed_reference",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            authors: { type: "string" },
            journal: { type: "string" },
            year: { type: ["number", "null"] },
            volume: { type: "string" },
            issue: { type: "string" },
            pages: { type: "string" },
            pmid: { type: "string" },
            doi: { type: "string" },
            url: { type: "string" },
            citationText: { type: "string" },
            note: { type: "string" },
          },
          required: [
            "title",
            "authors",
            "journal",
            "year",
            "volume",
            "issue",
            "pages",
            "pmid",
            "doi",
            "url",
            "citationText",
            "note",
          ],
        },
      },
    },
    messages: [
      {
        role: "system",
        content:
          "You extract citation metadata from pasted references. Extract only information present in the citation. Do not invent missing fields. Normalize PMID to digits only. Normalize DOI without any leading doi URL prefix. Use year as a number when available. Put any uncertainty or extra citation information in note. Return JSON only.",
      },
      {
        role: "user",
        content: `Parse this citation into the required JSON schema:\n\n${citationText}`,
      },
    ],
  };

  const response = await postJson(
    OPENAI_API_URL,
    {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    payload
  );

  if (response.status < 200 || response.status >= 300) {
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      "The reference parser could not process that citation right now."
    );
  }

  let parsedResponse;
  try {
    parsedResponse = JSON.parse(response.data);
  } catch (error) {
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      "The reference parser returned an unreadable response."
    );
  }

  const content = extractOpenAiMessageContent(parsedResponse);
  if (!content) {
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      "The reference parser did not return any parsed fields."
    );
  }

  let parsedReference;
  try {
    parsedReference = JSON.parse(content);
  } catch (error) {
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      "The reference parser returned invalid JSON."
    );
  }

  return normalizeParsedReference(parsedReference, citationText);
});

Parse.Cloud.define("uploadQuestionMedia", async (request) => {
  const user = requireAuthenticatedUser(request);
  const params = request.params || {};
  const questionId = requireObjectId(params.questionId, "questionId");
  const fileName = requireString(params.fileName, "fileName");
  const contentType = requireString(params.contentType, "contentType").toLowerCase();
  const base64Data = requireString(params.base64Data, "base64Data");
  const placement = requireAllowedValue(params.placement, "placement", ALLOWED_MEDIA_PLACEMENTS);
  const mediaType = requireAllowedValue(params.mediaType, "mediaType", ALLOWED_MEDIA_TYPES);
  const caption = normalizeOptionalString(params.caption);
  const altText = normalizeOptionalString(params.altText);
  const sortOrder = params.sortOrder === undefined ? 0 : normalizeOptionalNumber(params.sortOrder, "sortOrder");

  if (mediaType === "IMAGE" && !contentType.startsWith("image/")) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, "IMAGE uploads must use an image content type.");
  }

  if (mediaType === "VIDEO" && !contentType.startsWith("video/")) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, "VIDEO uploads must use a video content type.");
  }

  const questionQuery = new Parse.Query(Question);
  let question;
  try {
    question = await questionQuery.get(questionId, { useMasterKey: true });
  } catch (error) {
    if (error?.code === Parse.Error.OBJECT_NOT_FOUND) {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, "Question not found.");
    }

    throw error;
  }

  const fileBuffer = decodeBase64File(base64Data);
  if (!fileBuffer.length) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, "base64Data is invalid.");
  }

  const r2Config = requireR2Config();
  const fileKey = buildQuestionMediaKey(questionId, placement, mediaType, fileName);
  const publicUrl = buildPublicUrl(r2Config.endpoint, r2Config.bucketName, fileKey);

  await putObjectToR2({
    endpoint: r2Config.endpoint,
    bucketName: r2Config.bucketName,
    accessKeyId: r2Config.accessKeyId,
    secretAccessKey: r2Config.secretAccessKey,
    key: fileKey,
    body: fileBuffer,
    contentType,
  });

  const questionMedia = new QuestionMedia();
  questionMedia.set("question", question);
  questionMedia.set("mediaType", mediaType);
  questionMedia.set("storageProvider", "R2");
  questionMedia.set("fileKey", fileKey);
  questionMedia.set("publicUrl", publicUrl);
  questionMedia.set("caption", caption === undefined ? "" : caption);
  questionMedia.set("altText", altText === undefined ? "" : altText);
  questionMedia.set("placement", placement);
  questionMedia.set("sortOrder", sortOrder === undefined ? 0 : sortOrder);
  questionMedia.set("uploadedBy", user);
  questionMedia.set("uploadedAt", new Date());
  questionMedia.set("status", "ACTIVE");

  // Frontend should call Parse.Cloud.run("uploadQuestionMedia", params) after the user
  // has selected a file and a Question has already been created, so questionId is valid.
  const savedQuestionMedia = await questionMedia.save(null, { useMasterKey: true });

  return {
    success: true,
    mediaId: savedQuestionMedia.id,
    fileKey,
    publicUrl,
    mediaType,
    placement,
  };
});

Parse.Cloud.define("diagnoseAwsSdk", async () => {
  const r2Config = requireR2Config();

  return {
    success: true,
    packageName: "built-in-node-modules-only",
    usesExternalAwsSdk: false,
    endpoint: r2Config.endpoint,
    bucketName: r2Config.bucketName,
    hasAccessKeyId: Boolean(r2Config.accessKeyId),
    hasSecretAccessKey: Boolean(r2Config.secretAccessKey),
    message: "R2 uploads now use built-in Node.js modules and no external AWS SDK package.",
  };
});

Parse.Cloud.define("addReference", async (request) => {
  const reference = new Reference();
  applyReferenceFields(reference, request.params || {});

  if (!reference.get("title") && !reference.get("pmid") && !reference.get("doi") && !reference.get("url")) {
    throw new Parse.Error(
      Parse.Error.VALIDATION_ERROR,
      "A reference must include at least a title, PMID, DOI, or URL."
    );
  }

  if (reference.get("isActive") === undefined) {
    reference.set("isActive", true);
  }

  const savedReference = await reference.save(null, { useMasterKey: true });

  return {
    objectId: savedReference.id,
  };
});

Parse.Cloud.define("addQuestionReference", async (request) => {
  const questionReference = new QuestionReference();
  applyQuestionReferenceFields(questionReference, request.params || {}, {
    requireQuestion: true,
    requireReference: true,
  });

  if (questionReference.get("sortOrder") === undefined) {
    questionReference.set("sortOrder", 0);
  }

  if (questionReference.get("isPrimary") === undefined) {
    questionReference.set("isPrimary", false);
  }

  const savedQuestionReference = await questionReference.save(null, { useMasterKey: true });

  return {
    objectId: savedQuestionReference.id,
  };
});

Parse.Cloud.define("addQuestionOption", async (request) => {
  const option = new QuestionOption();
  applyQuestionOptionFields(option, request.params || {}, {
    requireQuestion: true,
    requireLabel: true,
    requireText: true,
  });

  const savedOption = await option.save(null, { useMasterKey: true });
  return serializeQuestionOption(savedOption);
});

Parse.Cloud.define("getQuestionOption", async (request) => {
  const objectId = requireString(request.params.objectId, "objectId");
  const query = new Parse.Query(QuestionOption);
  const option = await query.get(objectId, { useMasterKey: true });

  return serializeQuestionOption(option);
});

Parse.Cloud.define("editQuestionOption", async (request) => {
  const objectId = requireString(request.params.objectId, "objectId");
  const query = new Parse.Query(QuestionOption);
  const option = await query.get(objectId, { useMasterKey: true });

  applyQuestionOptionFields(option, request.params || {});

  const savedOption = await option.save(null, { useMasterKey: true });
  return serializeQuestionOption(savedOption);
});

Parse.Cloud.define("deleteQuestionOption", async (request) => {
  const objectId = requireString(request.params.objectId, "objectId");
  const query = new Parse.Query(QuestionOption);
  const option = await query.get(objectId, { useMasterKey: true });

  await option.destroy({ useMasterKey: true });

  return {
    objectId,
    deleted: true,
  };
});

Parse.Cloud.define("listQuestionOptions", async (request) => {
  const params = request.params || {};
  const query = new Parse.Query(QuestionOption);

  if (Object.prototype.hasOwnProperty.call(params, "questionObjectId")) {
    const questionObjectId = requireString(params.questionObjectId, "questionObjectId");
    const question = new Question();
    question.id = questionObjectId;
    query.equalTo("question", question);
  }

  query.ascending("sortOrder");
  query.ascending("label");
  query.limit(1000);

  const options = await query.find({ useMasterKey: true });
  return options.map(serializeQuestionOption);
});
