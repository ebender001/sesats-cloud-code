const Question = Parse.Object.extend("Question");
const QuestionOption = Parse.Object.extend("QuestionOption");
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

function normalizeOptionalNumber(value, fieldName) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${fieldName} must be a number.`);
  }

  return value;
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
