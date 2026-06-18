const Question = Parse.Object.extend("Question");
const ParseUser = Parse.User;

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

Parse.Cloud.define("addQuestion", async (request) => {
  const question = new Question();
  applyQuestionFields(question, request.params || {}, { requireStem: true });

  const savedQuestion = await question.save(null, { useMasterKey: true });
  return serializeQuestion(savedQuestion);
});

Parse.Cloud.define("getQuestion", async (request) => {
  const objectId = requireString(request.params.objectId, "objectId");
  const query = new Parse.Query(Question);
  const question = await query.get(objectId, { useMasterKey: true });

  return serializeQuestion(question);
});

Parse.Cloud.define("editQuestion", async (request) => {
  const objectId = requireString(request.params.objectId, "objectId");
  const query = new Parse.Query(Question);
  const question = await query.get(objectId, { useMasterKey: true });

  applyQuestionFields(question, request.params || {});

  const savedQuestion = await question.save(null, { useMasterKey: true });
  return serializeQuestion(savedQuestion);
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
  return questions.map(serializeQuestion);
});
