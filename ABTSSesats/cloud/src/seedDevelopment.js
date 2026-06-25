const { requireAdminAccess } = require("./users");

const Institution = Parse.Object.extend("Institution");
const Specialty = Parse.Object.extend("Specialty");
const Topic = Parse.Object.extend("Topic");
const Status = Parse.Object.extend("Status");
const Question = Parse.Object.extend("Question");
const QuestionOption = Parse.Object.extend("QuestionOption");
const QuestionMedia = Parse.Object.extend("QuestionMedia");
const QuestionReview = Parse.Object.extend("QuestionReview");
const QuestionEditHistory = Parse.Object.extend("QuestionEditHistory");
const Reference = Parse.Object.extend("Reference");
const QuestionReference = Parse.Object.extend("QuestionReference");
const UserProgress = Parse.Object.extend("UserProgress");
const AIGenerationJob = Parse.Object.extend("AIGenerationJob");
const UserRoleAssignment = Parse.Object.extend("UserRoleAssignment");
const UserInvitation = Parse.Object.extend("UserInvitation");

const SAVE_BATCH_SIZE = 50;
const DELETE_BATCH_SIZE = 100;

const SEEDED_CLASS_ORDER = [
  "Institution",
  "Specialty",
  "Topic",
  "Status",
  "Question",
  "QuestionOption",
  "Reference",
  "QuestionReference",
  "QuestionMedia",
  "QuestionReview",
  "QuestionEditHistory",
  "UserProgress",
  "AIGenerationJob",
  "UserRoleAssignment",
  "UserInvitation",
];

const CLEAR_CLASS_ORDER = [
  "UserProgress",
  "QuestionEditHistory",
  "QuestionReview",
  "QuestionMedia",
  "QuestionReference",
  "QuestionOption",
  "Reference",
  "Question",
  "AIGenerationJob",
  "Topic",
  "UserRoleAssignment",
  "UserInvitation",
  "Institution",
  "Specialty",
  "Status",
];

const CLASS_MAP = {
  Institution,
  Specialty,
  Topic,
  Status,
  Question,
  QuestionOption,
  QuestionMedia,
  QuestionReview,
  QuestionEditHistory,
  Reference,
  QuestionReference,
  UserProgress,
  AIGenerationJob,
  UserRoleAssignment,
  UserInvitation,
};

const STATUS_DEFINITIONS = [
  {
    code: "draft",
    name: "Draft",
    description: "Newly authored question awaiting structured review.",
    sortOrder: 10,
    isActive: true,
    isTerminal: false,
    color: "#6B7280",
  },
  {
    code: "needs_review",
    name: "Needs Review",
    description: "Ready for editorial review.",
    sortOrder: 20,
    isActive: true,
    isTerminal: false,
    color: "#2563EB",
  },
  {
    code: "revision_requested",
    name: "Revision Requested",
    description: "Requires edits before approval.",
    sortOrder: 30,
    isActive: true,
    isTerminal: false,
    color: "#D97706",
  },
  {
    code: "approved",
    name: "Approved",
    description: "Approved for publication planning.",
    sortOrder: 40,
    isActive: true,
    isTerminal: false,
    color: "#059669",
  },
  {
    code: "published",
    name: "Published",
    description: "Available to learners in the application.",
    sortOrder: 50,
    isActive: true,
    isTerminal: false,
    color: "#0F766E",
  },
  {
    code: "archived",
    name: "Archived",
    description: "Retained for history and no longer shown in normal study flows.",
    sortOrder: 60,
    isActive: false,
    isTerminal: true,
    color: "#475569",
  },
  {
    code: "scheduled",
    name: "Scheduled",
    description: "Approved and queued for a future release.",
    sortOrder: 70,
    isActive: true,
    isTerminal: false,
    color: "#7C3AED",
  },
  {
    code: "pilot",
    name: "Pilot",
    description: "In limited beta testing with faculty reviewers.",
    sortOrder: 80,
    isActive: true,
    isTerminal: false,
    color: "#1D4ED8",
  },
  {
    code: "retired",
    name: "Retired",
    description: "Removed from active delivery but kept for audit.",
    sortOrder: 90,
    isActive: false,
    isTerminal: true,
    color: "#991B1B",
  },
  {
    code: "blocked",
    name: "Blocked",
    description: "Temporarily blocked pending source or policy resolution.",
    sortOrder: 100,
    isActive: true,
    isTerminal: false,
    color: "#B45309",
  },
];

const SPECIALTY_DEFINITIONS = [
  {
    name: "Adult Cardiac Surgery",
    shortName: "ACS",
    description: "Operative and perioperative decision-making for adult cardiac surgery.",
  },
  {
    name: "General Thoracic Surgery",
    shortName: "GTS",
    description: "Thoracic oncology, airway, pleural, chest wall, and esophageal surgery.",
  },
  {
    name: "Congenital Cardiac Surgery",
    shortName: "CCS",
    description: "Congenital heart disease surgery across neonatal to adult transitions.",
  },
  {
    name: "Cardiothoracic Critical Care",
    shortName: "CT-ICU",
    description: "Critical care for cardiothoracic surgical patients.",
  },
  {
    name: "Heart and Lung Transplantation",
    shortName: "HLT",
    description: "Transplantation, MCS bridging, and thoracic organ failure management.",
  },
];

const TOPIC_DEFINITIONS = [
  { specialtyName: "Adult Cardiac Surgery", name: "Coronary Revascularization" },
  { specialtyName: "Adult Cardiac Surgery", name: "Valve Repair and Replacement" },
  { specialtyName: "Adult Cardiac Surgery", name: "Aortic Root and Ascending Aorta" },
  { specialtyName: "Adult Cardiac Surgery", name: "Mechanical Circulatory Support" },
  { specialtyName: "General Thoracic Surgery", name: "Lung Cancer Staging and Resection" },
  { specialtyName: "General Thoracic Surgery", name: "Esophageal Perforation and Reconstruction" },
  { specialtyName: "General Thoracic Surgery", name: "Tracheal and Airway Surgery" },
  { specialtyName: "General Thoracic Surgery", name: "Mediastinal Masses and Chest Wall" },
  { specialtyName: "Congenital Cardiac Surgery", name: "Neonatal Arch and Outflow Tract Lesions" },
  { specialtyName: "Congenital Cardiac Surgery", name: "Single Ventricle Palliation" },
  { specialtyName: "Congenital Cardiac Surgery", name: "Tetralogy and RVOT Management" },
  { specialtyName: "Congenital Cardiac Surgery", name: "Adult Congenital Reintervention" },
  { specialtyName: "Cardiothoracic Critical Care", name: "Post-Cardiotomy Shock" },
  { specialtyName: "Cardiothoracic Critical Care", name: "ECMO and Temporary Support" },
  { specialtyName: "Cardiothoracic Critical Care", name: "Ventilator and Airway Rescue" },
  { specialtyName: "Cardiothoracic Critical Care", name: "Coagulopathy and Massive Transfusion" },
  { specialtyName: "Heart and Lung Transplantation", name: "Heart Transplant Candidate Selection" },
  { specialtyName: "Heart and Lung Transplantation", name: "Lung Transplant Primary Graft Dysfunction" },
  { specialtyName: "Heart and Lung Transplantation", name: "Pulmonary Hypertension and RV Failure" },
  { specialtyName: "Heart and Lung Transplantation", name: "Vascular Adjacent Access and Great Vessel Exposure" },
];

const INSTITUTION_DEFINITIONS = [
  {
    name: "Midwest Heart Institute",
    institutionType: "Academic Medical Center",
    city: "Chicago",
    stateProvince: "IL",
    country: "USA",
    website: "https://example.com/midwest-heart",
    contactEmail: "seed-midwest-heart@example.com",
  },
  {
    name: "Lakefront Cardiothoracic Center",
    institutionType: "University Hospital",
    city: "Milwaukee",
    stateProvince: "WI",
    country: "USA",
    website: "https://example.com/lakefront-cts",
    contactEmail: "seed-lakefront-cts@example.com",
  },
  {
    name: "Prairie Valve and Aorta Program",
    institutionType: "Regional Referral Center",
    city: "Madison",
    stateProvince: "WI",
    country: "USA",
    website: "https://example.com/prairie-valve",
    contactEmail: "seed-prairie-valve@example.com",
  },
  {
    name: "Great Lakes Thoracic Oncology Institute",
    institutionType: "Cancer Center",
    city: "Cleveland",
    stateProvince: "OH",
    country: "USA",
    website: "https://example.com/great-lakes-thoracic",
    contactEmail: "seed-greatlakes-thoracic@example.com",
  },
  {
    name: "Riverbend Children's Heart Hospital",
    institutionType: "Children's Hospital",
    city: "St. Louis",
    stateProvince: "MO",
    country: "USA",
    website: "https://example.com/riverbend-children-heart",
    contactEmail: "seed-riverbend-heart@example.com",
  },
  {
    name: "Southern Plains ECMO and Shock Center",
    institutionType: "Tertiary Hospital",
    city: "Dallas",
    stateProvince: "TX",
    country: "USA",
    website: "https://example.com/southern-plains-ecmo",
    contactEmail: "seed-southern-plains@example.com",
  },
  {
    name: "Harborview Heart and Lung Transplant Institute",
    institutionType: "Transplant Center",
    city: "Seattle",
    stateProvince: "WA",
    country: "USA",
    website: "https://example.com/harborview-transplant",
    contactEmail: "seed-harborview-tx@example.com",
  },
  {
    name: "Atlantic Aortic and Vascular Adjacent Program",
    institutionType: "Integrated Health System",
    city: "Boston",
    stateProvince: "MA",
    country: "USA",
    website: "https://example.com/atlantic-aortic",
    contactEmail: "seed-atlantic-aortic@example.com",
  },
];

const QUESTION_STATUS_CODES = [
  "draft",
  "needs_review",
  "revision_requested",
  "approved",
  "published",
  "archived",
];

const QUESTION_DIFFICULTIES = ["easy", "medium", "hard", "expert"];
const REVIEW_DECISIONS = ["approved", "revision_requested", "needs_minor_edits"];
const AI_JOB_STATUSES = ["queued", "running", "completed", "failed"];
const OPTION_LABELS = ["A", "B", "C", "D", "E"];

const STEM_SNIPPETS = [
  "What is the most appropriate next operative or perioperative step?",
  "Which finding most strongly changes management?",
  "What is the best rescue strategy at this point?",
  "Which option best reflects current board-style decision-making?",
];

const EXPLANATION_SNIPPETS = [
  "The preferred approach aligns anatomy, physiology, timing, and operative risk.",
  "The key distinction is between reversible physiology and a structural problem requiring intervention.",
  "The answer depends on choosing the safest definitive option rather than the fastest temporary maneuver.",
];

const CRITIQUE_SNIPPETS = [
  "A strong response prioritizes mechanism, timing, and a clear operative threshold before discussing alternatives.",
  "Candidates should demonstrate situational awareness, communicate risk, and explain why nearby distractors are less appropriate.",
  "High-scoring answers connect the imaging or hemodynamic finding to an immediate, defensible management plan.",
];

const LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed non risus. Suspendisse lectus tortor, dignissim sit amet, adipiscing nec, ultricies sed, dolor.";

function requireAuthenticatedUser(request) {
  if (!request.user) {
    throw new Parse.Error(Parse.Error.SESSION_MISSING, "Authentication required.");
  }

  return request.user;
}

async function requireAdmin(request) {
  const user = requireAuthenticatedUser(request);
  await requireAdminAccess(user);
  return user;
}

function chunkArray(items, size) {
  const batches = [];

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
}

async function saveInBatches(objects) {
  const saved = [];

  for (const batch of chunkArray(objects, SAVE_BATCH_SIZE)) {
    if (!batch.length) {
      continue;
    }

    const savedBatch = await Parse.Object.saveAll(batch, { useMasterKey: true });
    saved.push(...savedBatch);
  }

  return saved;
}

async function destroySeedRowsForClass(className, seedBatchId) {
  let deletedCount = 0;

  while (true) {
    const query = new Parse.Query(CLASS_MAP[className]);
    query.equalTo("isSeedData", true);
    if (seedBatchId) {
      query.equalTo("seedBatchId", seedBatchId);
    }
    query.limit(DELETE_BATCH_SIZE);

    const rows = await query.find({ useMasterKey: true });
    if (!rows.length) {
      break;
    }

    await Parse.Object.destroyAll(rows, { useMasterKey: true });
    deletedCount += rows.length;
  }

  return deletedCount;
}

function formatBatchTimestampPart(value) {
  return String(value).padStart(2, "0");
}

function buildSeedBatchId(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = formatBatchTimestampPart(date.getUTCMonth() + 1);
  const day = formatBatchTimestampPart(date.getUTCDate());
  const hours = formatBatchTimestampPart(date.getUTCHours());
  const minutes = formatBatchTimestampPart(date.getUTCMinutes());
  const seconds = formatBatchTimestampPart(date.getUTCSeconds());

  return `seed-${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function seedObject(object, seedBatchId) {
  object.set("isSeedData", true);
  object.set("seedBatchId", seedBatchId);
  return object;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickOne(items) {
  return items[randomInt(0, items.length - 1)];
}

function pickMany(items, count) {
  const pool = [...items];
  const selected = [];

  while (pool.length && selected.length < count) {
    const index = randomInt(0, pool.length - 1);
    selected.push(pool.splice(index, 1)[0]);
  }

  return selected;
}

function buildLongText(prefix, topicName, specialtyName, extraSnippet) {
  return `${prefix} ${topicName} in ${specialtyName}. ${extraSnippet} ${LOREM} ${LOREM}`;
}

async function createSeedInstitutions(seedBatchId) {
  const institutions = INSTITUTION_DEFINITIONS.map((definition) => {
    const institution = seedObject(new Institution(), seedBatchId);
    institution.set("name", definition.name);
    institution.set("institutionType", definition.institutionType);
    institution.set("city", definition.city);
    institution.set("stateProvince", definition.stateProvince);
    institution.set("country", definition.country);
    institution.set("website", definition.website);
    institution.set("contactEmail", definition.contactEmail);
    institution.set("isActive", true);
    return institution;
  });

  return saveInBatches(institutions);
}

async function createSeedSpecialties(seedBatchId) {
  const specialties = SPECIALTY_DEFINITIONS.map((definition, index) => {
    const specialty = seedObject(new Specialty(), seedBatchId);
    specialty.set("name", definition.name);
    specialty.set("shortName", definition.shortName);
    specialty.set("description", definition.description);
    specialty.set("sortOrder", index + 1);
    specialty.set("isActive", true);
    return specialty;
  });

  return saveInBatches(specialties);
}

async function createSeedTopics(seedBatchId, specialtiesByName) {
  const topics = TOPIC_DEFINITIONS.map((definition) => {
    const specialty = specialtiesByName.get(definition.specialtyName);
    const topic = seedObject(new Topic(), seedBatchId);
    topic.set("name", definition.name);
    topic.set("specialtyObjectId", specialty?.id || "");
    topic.set("specialty", specialty || null);
    return topic;
  });

  return saveInBatches(topics);
}

async function createMissingStatuses(seedBatchId) {
  const existingStatuses = await new Parse.Query(Status).limit(1000).find({ useMasterKey: true });
  const existingKeys = new Set();

  existingStatuses.forEach((status) => {
    const code = String(status.get("code") || "").trim().toLowerCase();
    const name = String(status.get("name") || "").trim().toLowerCase();

    if (code) {
      existingKeys.add(`code:${code}`);
    }
    if (name) {
      existingKeys.add(`name:${name}`);
    }
  });

  const missingDefinitions = STATUS_DEFINITIONS.filter((definition) => {
    return (
      !existingKeys.has(`code:${definition.code.toLowerCase()}`) &&
      !existingKeys.has(`name:${definition.name.toLowerCase()}`)
    );
  });

  const statusesToCreate = missingDefinitions.map((definition) => {
    const status = seedObject(new Status(), seedBatchId);
    status.set("code", definition.code);
    status.set("name", definition.name);
    status.set("description", definition.description);
    status.set("sortOrder", definition.sortOrder);
    status.set("isActive", definition.isActive);
    status.set("isTerminal", definition.isTerminal);
    status.set("color", definition.color);
    return status;
  });

  const savedStatuses = await saveInBatches(statusesToCreate);

  return {
    createdStatuses: savedStatuses,
    createdCount: savedStatuses.length,
    existingCount: STATUS_DEFINITIONS.length - savedStatuses.length,
  };
}

async function createSeedQuestions({
  seedBatchId,
  questionCount,
  specialties,
  topics,
}) {
  const topicsBySpecialtyName = new Map();

  topics.forEach((topic) => {
    const specialty = topic.get("specialty");
    const specialtyName = specialty?.get("name") || "";

    if (!topicsBySpecialtyName.has(specialtyName)) {
      topicsBySpecialtyName.set(specialtyName, []);
    }

    topicsBySpecialtyName.get(specialtyName).push(topic);
  });

  const questions = [];

  for (let index = 0; index < questionCount; index += 1) {
    const specialty = specialties[index % specialties.length];
    const specialtyName = specialty.get("name") || "";
    const specialtyTopics = topicsBySpecialtyName.get(specialtyName) || topics;
    const topic = specialtyTopics[index % specialtyTopics.length];
    const topicName = topic.get("name") || "Cardiothoracic Surgery";
    const statusCode = QUESTION_STATUS_CODES[index % QUESTION_STATUS_CODES.length];
    const difficulty = QUESTION_DIFFICULTIES[index % QUESTION_DIFFICULTIES.length];
    const generatedByAI = index % 4 === 0;

    const question = seedObject(new Question(), seedBatchId);
    question.set(
      "stem",
      buildLongText(
        `Seed question ${index + 1}: ${topicName}. ${pickOne(STEM_SNIPPETS)}`,
        topicName,
        specialtyName,
        LOREM
      )
    );
    question.set(
      "explanation",
      buildLongText("Explanation:", topicName, specialtyName, pickOne(EXPLANATION_SNIPPETS))
    );
    question.set(
      "critique",
      buildLongText("Critique:", topicName, specialtyName, pickOne(CRITIQUE_SNIPPETS))
    );
    question.set("difficulty", difficulty);
    question.set("specialty", specialtyName);
    question.set("topic", topicName);
    question.set("status", statusCode);
    question.set("generatedByAI", generatedByAI);
    question.set("aiModel", generatedByAI ? "seed-gpt-4.1-mini" : "");
    question.set("aiPromptVersion", generatedByAI ? "seed-dev-v1" : "");
    question.set("lastEditedAt", new Date(Date.now() - index * 3600 * 1000));
    questions.push(question);
  }

  return saveInBatches(questions);
}

async function createSeedQuestionChildren({ seedBatchId, questions }) {
  const options = [];
  const references = [];
  const questionReferences = [];
  const media = [];
  const reviews = [];
  const editHistory = [];
  const aiJobs = [];

  questions.forEach((question, questionIndex) => {
    const correctOptionIndex = questionIndex % OPTION_LABELS.length;
    const questionStatus = question.get("status") || "draft";

    OPTION_LABELS.forEach((label, optionIndex) => {
      const option = seedObject(new QuestionOption(), seedBatchId);
      option.set("question", question);
      option.set("label", label);
      option.set(
        "text",
        `${label}. ${question.get("topic")} option ${optionIndex + 1} focused on ${question.get("specialty")}.`
      );
      option.set("isCorrect", optionIndex === correctOptionIndex);
      option.set("sortOrder", optionIndex);
      options.push(option);
    });

    const referenceCount = (questionIndex % 3) + 1;
    const questionReferencesForQuestion = [];

    for (let refIndex = 0; refIndex < referenceCount; refIndex += 1) {
      const reference = seedObject(new Reference(), seedBatchId);
      reference.set("title", `${question.get("topic")} Outcomes Review ${questionIndex + 1}.${refIndex + 1}`);
      reference.set("authors", "Seed Author, Example Surgeon, Demo Reviewer");
      reference.set("journal", "Journal of Seeded Cardiothoracic Cases");
      reference.set("volume", String(10 + refIndex));
      reference.set("issue", String((questionIndex % 4) + 1));
      reference.set("pages", `${100 + questionIndex}-${104 + questionIndex}`);
      reference.set("doi", `10.0000/seed.${questionIndex + 1}.${refIndex + 1}`);
      reference.set("pmid", String(9000000 + questionIndex * 10 + refIndex));
      reference.set("url", `https://example.com/seed/reference/${questionIndex + 1}-${refIndex + 1}`);
      reference.set(
        "citationText",
        `Seed Author et al. ${question.get("topic")} outcomes review ${questionIndex + 1}.${refIndex + 1}.`
      );
      reference.set("abstract", `${LOREM} ${LOREM}`);
      reference.set("isActive", true);
      reference.set("year", 2018 + (questionIndex % 7));
      references.push(reference);
      questionReferencesForQuestion.push(reference);
    }

    questionReferencesForQuestion.forEach((reference, refIndex) => {
      const link = seedObject(new QuestionReference(), seedBatchId);
      link.set("question", question);
      link.set("reference", reference);
      link.set("sortOrder", refIndex);
      link.set("isPrimary", refIndex === 0);
      link.set("note", refIndex === 0 ? "Primary seed citation." : "Supporting seed citation.");
      questionReferences.push(link);
    });

    const mediaCount = questionIndex % 3;
    for (let mediaIndex = 0; mediaIndex < mediaCount; mediaIndex += 1) {
      const mediaRecord = seedObject(new QuestionMedia(), seedBatchId);
      mediaRecord.set("question", question);
      mediaRecord.set("storageProvider", "seed");
      mediaRecord.set("fileKey", `seed/questions/${question.id}/image-${mediaIndex + 1}.png`);
      mediaRecord.set("publicUrl", `https://example.com/seed/image-${mediaIndex + 1}.png`);
      mediaRecord.set("mediaType", "image");
      mediaRecord.set("caption", "Seed image caption");
      mediaRecord.set("altText", "Seed image alt text");
      mediaRecord.set("placement", "question");
      mediaRecord.set("status", "active");
      mediaRecord.set("sortOrder", mediaIndex);
      media.push(mediaRecord);
    }

    if (questionIndex % 2 === 0) {
      const review = seedObject(new QuestionReview(), seedBatchId);
      review.set("question", question);
      review.set("decision", REVIEW_DECISIONS[questionIndex % REVIEW_DECISIONS.length]);
      review.set("comments", `${LOREM} ${LOREM}`);
      review.set("reviewedAt", new Date(Date.now() - questionIndex * 1800 * 1000));
      reviews.push(review);
    }

    if (questionIndex % 3 === 0) {
      const history = seedObject(new QuestionEditHistory(), seedBatchId);
      history.set("question", question);
      history.set(
        "previousStatus",
        QUESTION_STATUS_CODES[(QUESTION_STATUS_CODES.indexOf(questionStatus) + QUESTION_STATUS_CODES.length - 1) % QUESTION_STATUS_CODES.length]
      );
      history.set("newStatus", questionStatus);
      history.set("changeSummary", `${LOREM} ${LOREM}`);
      history.set("editedAt", new Date(Date.now() - questionIndex * 2700 * 1000));
      history.set("previousSnapshot", {
        status: "draft",
        difficulty: question.get("difficulty"),
        topic: question.get("topic"),
      });
      history.set("newSnapshot", {
        status: questionStatus,
        difficulty: question.get("difficulty"),
        topic: question.get("topic"),
      });
      editHistory.push(history);
    }

    if (questionIndex % 16 === 0) {
      const job = seedObject(new AIGenerationJob(), seedBatchId);
      job.set("specialty", question.get("specialty"));
      job.set("topic", question.get("topic"));
      job.set("promptVersion", "seed-dev-v1");
      job.set("model", "seed-gpt-4.1-mini");
      job.set("status", AI_JOB_STATUSES[questionIndex % AI_JOB_STATUSES.length]);
      job.set("generatedQuestionCount", randomInt(2, 12));
      aiJobs.push(job);
    }
  });

  const savedOptions = await saveInBatches(options);
  await saveInBatches(references);
  await saveInBatches(questionReferences);
  await saveInBatches(media);
  await saveInBatches(reviews);
  await saveInBatches(editHistory);
  const savedJobs = await saveInBatches(aiJobs);

  return {
    QuestionOption: savedOptions.length,
    Reference: references.length,
    QuestionReference: questionReferences.length,
    QuestionMedia: media.length,
    QuestionReview: reviews.length,
    QuestionEditHistory: editHistory.length,
    AIGenerationJob: savedJobs.length,
    UserProgress: 0,
    UserRoleAssignment: 0,
    UserInvitation: 0,
  };
}

async function countSeedRows(className, seedBatchId) {
  const query = new Parse.Query(CLASS_MAP[className]);
  query.equalTo("isSeedData", true);
  if (seedBatchId) {
    query.equalTo("seedBatchId", seedBatchId);
  }
  return query.count({ useMasterKey: true });
}

async function fetchSeedRows(className, seedBatchId) {
  const rows = [];
  let skip = 0;

  while (true) {
    const query = new Parse.Query(CLASS_MAP[className]);
    query.equalTo("isSeedData", true);
    if (seedBatchId) {
      query.equalTo("seedBatchId", seedBatchId);
    }
    query.select("seedBatchId");
    query.limit(1000);
    query.skip(skip);

    const batch = await query.find({ useMasterKey: true });
    rows.push(...batch);

    if (batch.length < 1000) {
      break;
    }

    skip += batch.length;
  }

  return rows;
}

Parse.Cloud.define("seedDevelopmentData", async (request) => {
  await requireAdmin(request);

  // Development/UI testing only. All records created here must stay explicitly marked
  // with isSeedData=true so they can be summarized and safely cleared later.
  const params = request.params || {};
  const questionCount = Math.max(1, Math.min(500, Number.parseInt(params.questionCount, 10) || 200));
  const seedBatchId = buildSeedBatchId();

  const createdCounts = {};

  const institutions = await createSeedInstitutions(seedBatchId);
  createdCounts.Institution = institutions.length;

  const specialties = await createSeedSpecialties(seedBatchId);
  createdCounts.Specialty = specialties.length;

  const specialtiesByName = new Map(specialties.map((specialty) => [specialty.get("name"), specialty]));
  const topics = await createSeedTopics(seedBatchId, specialtiesByName);
  createdCounts.Topic = topics.length;

  const statusResult = await createMissingStatuses(seedBatchId);
  createdCounts.Status = statusResult.createdCount;

  const questions = await createSeedQuestions({
    seedBatchId,
    questionCount,
    specialties,
    topics,
  });
  createdCounts.Question = questions.length;

  const childCounts = await createSeedQuestionChildren({
    seedBatchId,
    questions,
  });

  SEEDED_CLASS_ORDER.forEach((className) => {
    if (createdCounts[className] === undefined) {
      createdCounts[className] = childCounts[className] || 0;
    }
  });

  return {
    success: true,
    seedBatchId,
    createdCounts,
    notes: [
      "Seed functions are for development/UI testing only.",
      "Production CRUD defaults isSeedData to false unless explicitly set otherwise.",
      "UserProgress seed rows were skipped to avoid creating or mutating real users.",
      `Statuses created this run: ${statusResult.createdCount}; already present: ${statusResult.existingCount}.`,
    ],
  };
});

Parse.Cloud.define("clearSeedData", async (request) => {
  await requireAdmin(request);

  // Development/UI testing only. Never delete rows unless isSeedData===true.
  const params = request.params || {};
  const seedBatchId =
    typeof params.seedBatchId === "string" && params.seedBatchId.trim().length > 0
      ? params.seedBatchId.trim()
      : "";

  const deletedCounts = {};

  for (const className of CLEAR_CLASS_ORDER) {
    deletedCounts[className] = await destroySeedRowsForClass(className, seedBatchId);
  }

  return {
    success: true,
    seedBatchId: seedBatchId || null,
    deletedCounts,
  };
});

Parse.Cloud.define("getSeedDataSummary", async (request) => {
  await requireAdmin(request);

  const params = request.params || {};
  const groupBySeedBatchId = params.groupBySeedBatchId === true;
  const seedBatchId =
    typeof params.seedBatchId === "string" && params.seedBatchId.trim().length > 0
      ? params.seedBatchId.trim()
      : "";

  const countsByClass = {};
  for (const className of SEEDED_CLASS_ORDER) {
    countsByClass[className] = await countSeedRows(className, seedBatchId);
  }

  const response = {
    success: true,
    seedBatchId: seedBatchId || null,
    countsByClass,
  };

  if (groupBySeedBatchId) {
    const groupedBySeedBatchId = {};

    for (const className of SEEDED_CLASS_ORDER) {
      const rows = await fetchSeedRows(className, seedBatchId);

      rows.forEach((row) => {
        const batchId = row.get("seedBatchId") || "(missing)";
        if (!groupedBySeedBatchId[batchId]) {
          groupedBySeedBatchId[batchId] = {};
        }
        groupedBySeedBatchId[batchId][className] =
          (groupedBySeedBatchId[batchId][className] || 0) + 1;
      });
    }

    response.groupedBySeedBatchId = groupedBySeedBatchId;
  }

  return response;
});
