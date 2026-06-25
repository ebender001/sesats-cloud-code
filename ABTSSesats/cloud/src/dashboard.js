const Question = Parse.Object.extend("Question");
const QuestionOption = Parse.Object.extend("QuestionOption");
const QuestionMedia = Parse.Object.extend("QuestionMedia");
const QuestionReview = Parse.Object.extend("QuestionReview");
const QuestionEditHistory = Parse.Object.extend("QuestionEditHistory");
const Institution = Parse.Object.extend("Institution");
const Reference = Parse.Object.extend("Reference");
const QuestionReference = Parse.Object.extend("QuestionReference");
const Status = Parse.Object.extend("Status");
const UserInvitation = Parse.Object.extend("UserInvitation");

const QUERY_PAGE_SIZE = 1000;
const RECENT_TABLE_LIMIT = 8;

function normalizeOptionalBoolean(value, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value !== "boolean") {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, "includeSeedData must be a boolean.");
  }

  return value;
}

function normalizeOptionalString(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  if (typeof value !== "string") {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${fieldName} must be a string.`);
  }

  return value.trim();
}

function normalizeOptionalNumber(value, fieldName, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const normalizedNumber = Number.parseInt(String(value), 10);
  if (Number.isNaN(normalizedNumber) || normalizedNumber < 1) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${fieldName} must be a positive number.`);
  }

  return normalizedNumber;
}

function shortenText(value, maxLength = 84) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeStatusKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function normalizeDifficultyLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();

  if (normalized === "easy") {
    return "Easy";
  }

  if (normalized === "medium") {
    return "Medium";
  }

  if (normalized === "hard") {
    return "Hard";
  }

  if (normalized === "expert") {
    return "Expert";
  }

  if (!normalized) {
    return "Unspecified";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function startOfDayUtc(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function subtractDays(date, days) {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

function startOfMonthUtc(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function applySeedFilters(query, includeSeedData, seedBatchId) {
  if (!includeSeedData) {
    query.notEqualTo("isSeedData", true);
  }

  if (seedBatchId) {
    query.equalTo("seedBatchId", seedBatchId);
  }
}

async function fetchAll(query, { include = [], select = [], orderBy } = {}) {
  const results = [];
  let skip = 0;

  if (include.length) {
    query.include(include);
  }

  if (select.length) {
    query.select(select);
  }

  if (orderBy?.type === "descending") {
    query.descending(orderBy.field);
  }

  if (orderBy?.type === "ascending") {
    query.ascending(orderBy.field);
  }

  while (true) {
    query.limit(QUERY_PAGE_SIZE);
    query.skip(skip);

    const batch = await query.find({ useMasterKey: true });
    results.push(...batch);

    if (batch.length < QUERY_PAGE_SIZE) {
      break;
    }

    skip += batch.length;
  }

  return results;
}

function getPointerDisplayName(pointer) {
  if (!pointer) {
    return "";
  }

  return (
    pointer.get?.("displayName") ||
    pointer.get?.("username") ||
    pointer.get?.("email") ||
    ""
  );
}

function buildMonthBuckets(monthCount) {
  const now = new Date();
  const currentMonthStart = startOfMonthUtc(now);
  const buckets = [];

  for (let index = monthCount - 1; index >= 0; index -= 1) {
    const monthStart = new Date(
      Date.UTC(
        currentMonthStart.getUTCFullYear(),
        currentMonthStart.getUTCMonth() - index,
        1
      )
    );

    buckets.push({
      key: `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, "0")}`,
      label: monthStart.toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }),
      count: 0,
      start: monthStart,
    });
  }

  return buckets;
}

Parse.Cloud.define("getDashboardMetrics", async (request) => {
  const params = request.params || {};
  const includeSeedData = normalizeOptionalBoolean(params.includeSeedData, true);
  const seedBatchId = normalizeOptionalString(params.seedBatchId, "seedBatchId");
  const dateRangeDays = normalizeOptionalNumber(params.dateRangeDays, "dateRangeDays", 30);

  const modifiedSince = subtractDays(new Date(), dateRangeDays);
  const monthBuckets = buildMonthBuckets(12);
  const monthBucketMap = new Map(monthBuckets.map((bucket) => [bucket.key, bucket]));

  const statusQuery = new Parse.Query(Status);
  applySeedFilters(statusQuery, includeSeedData, seedBatchId);

  const questionQuery = new Parse.Query(Question);
  applySeedFilters(questionQuery, includeSeedData, seedBatchId);

  const referenceQuery = new Parse.Query(Reference);
  applySeedFilters(referenceQuery, includeSeedData, seedBatchId);

  const questionReferenceQuery = new Parse.Query(QuestionReference);
  applySeedFilters(questionReferenceQuery, includeSeedData, seedBatchId);

  const mediaQuery = new Parse.Query(QuestionMedia);
  applySeedFilters(mediaQuery, includeSeedData, seedBatchId);

  const optionQuery = new Parse.Query(QuestionOption);
  applySeedFilters(optionQuery, includeSeedData, seedBatchId);

  const editHistoryQuery = new Parse.Query(QuestionEditHistory);
  applySeedFilters(editHistoryQuery, includeSeedData, seedBatchId);

  const reviewQuery = new Parse.Query(QuestionReview);
  applySeedFilters(reviewQuery, includeSeedData, seedBatchId);

  const institutionCountQuery = new Parse.Query(Institution);
  applySeedFilters(institutionCountQuery, includeSeedData, seedBatchId);

  const invitationCountQuery = new Parse.Query(UserInvitation);
  applySeedFilters(invitationCountQuery, includeSeedData, seedBatchId);
  invitationCountQuery.equalTo("status", "pending");

  const [
    statuses,
    questions,
    references,
    questionReferences,
    mediaRecords,
    options,
    editHistory,
    reviews,
    institutions,
    pendingInvitations,
  ] = await Promise.all([
    fetchAll(statusQuery, { select: ["code", "name", "description", "color", "isActive"] }),
    fetchAll(questionQuery, {
      include: ["lastEditedBy"],
      select: [
        "stem",
        "specialty",
        "topic",
        "status",
        "difficulty",
        "critique",
        "explanation",
        "lastEditedAt",
        "lastEditedBy",
      ],
      orderBy: { type: "descending", field: "updatedAt" },
    }),
    fetchAll(referenceQuery, {
      select: ["title", "year"],
      orderBy: { type: "descending", field: "updatedAt" },
    }),
    fetchAll(questionReferenceQuery, {
      include: ["question", "reference"],
      select: ["question", "reference"],
    }),
    fetchAll(mediaQuery, {
      include: ["question"],
      select: ["question", "mediaType"],
    }),
    fetchAll(optionQuery, {
      include: ["question"],
      select: ["question", "isCorrect"],
    }),
    fetchAll(editHistoryQuery, {
      include: ["question", "editor"],
      select: ["question", "editor", "editedAt", "changeSummary", "previousStatus", "newStatus"],
      orderBy: { type: "descending", field: "editedAt" },
    }),
    fetchAll(reviewQuery, {
      include: ["question", "reviewer"],
      select: ["question", "reviewer", "reviewedAt", "decision"],
      orderBy: { type: "descending", field: "reviewedAt" },
    }),
    institutionCountQuery.count({ useMasterKey: true }),
    invitationCountQuery.count({ useMasterKey: true }),
  ]);

  const statusLabelsByKey = new Map();
  statuses.forEach((status) => {
    const codeKey = normalizeStatusKey(status.get("code"));
    const nameKey = normalizeStatusKey(status.get("name"));
    const label = status.get("name") || status.get("code") || "Unspecified";

    if (codeKey) {
      statusLabelsByKey.set(codeKey, label);
    }
    if (nameKey) {
      statusLabelsByKey.set(nameKey, label);
    }
  });

  const questionIdsWithReferences = new Set();
  questionReferences.forEach((link) => {
    const question = link.get("question");
    if (question?.id) {
      questionIdsWithReferences.add(question.id);
    }
  });

  const questionIdsWithMedia = new Set();
  const mediaByTypeMap = new Map([
    ["image", 0],
    ["video", 0],
    ["other", 0],
  ]);

  mediaRecords.forEach((record) => {
    const question = record.get("question");
    if (question?.id) {
      questionIdsWithMedia.add(question.id);
    }

    const mediaType = String(record.get("mediaType") || "").trim().toLowerCase();
    const bucket = mediaType === "image" ? "image" : mediaType === "video" ? "video" : "other";
    mediaByTypeMap.set(bucket, (mediaByTypeMap.get(bucket) || 0) + 1);
  });

  const questionIdsWithCorrectOption = new Set();
  options.forEach((option) => {
    if (option.get("isCorrect") === true) {
      const question = option.get("question");
      if (question?.id) {
        questionIdsWithCorrectOption.add(question.id);
      }
    }
  });

  const latestReviewByQuestionId = new Map();
  reviews.forEach((review) => {
    const questionId = review.get("question")?.id;
    if (!questionId || latestReviewByQuestionId.has(questionId)) {
      return;
    }

    latestReviewByQuestionId.set(questionId, review);
  });

  const questionsByStatusMap = new Map();
  const questionsBySpecialtyMap = new Map();
  const questionsByDifficultyMap = new Map();
  const referenceYearDistributionMap = new Map();
  const recentEditedQuestions = [];
  const reviewQueue = [];
  const contentGapCounters = {
    withoutReferences: 0,
    withoutMedia: 0,
    withoutCritique: 0,
    withoutExplanation: 0,
    withoutCorrectOption: 0,
  };

  questions.forEach((question) => {
    const questionId = question.id;
    const rawStatus = question.get("status") || "unspecified";
    const statusKey = normalizeStatusKey(rawStatus);
    const statusLabel = statusLabelsByKey.get(statusKey) || rawStatus || "Unspecified";
    const specialty = question.get("specialty") || "Unspecified";
    const difficulty = normalizeDifficultyLabel(question.get("difficulty"));
    const createdAt = question.createdAt instanceof Date ? question.createdAt : null;
    const lastEditedAt = question.get("lastEditedAt") || question.updatedAt || null;
    const questionStem = question.get("stem") || "";

    questionsByStatusMap.set(statusLabel, (questionsByStatusMap.get(statusLabel) || 0) + 1);
    questionsBySpecialtyMap.set(specialty, (questionsBySpecialtyMap.get(specialty) || 0) + 1);
    questionsByDifficultyMap.set(difficulty, (questionsByDifficultyMap.get(difficulty) || 0) + 1);

    if (createdAt) {
      const monthKey = `${createdAt.getUTCFullYear()}-${String(createdAt.getUTCMonth() + 1).padStart(2, "0")}`;
      const bucket = monthBucketMap.get(monthKey);
      if (bucket) {
        bucket.count += 1;
      }
    }

    if (!questionIdsWithReferences.has(questionId)) {
      contentGapCounters.withoutReferences += 1;
    }

    if (!questionIdsWithMedia.has(questionId)) {
      contentGapCounters.withoutMedia += 1;
    }

    if (!String(question.get("critique") || "").trim()) {
      contentGapCounters.withoutCritique += 1;
    }

    if (!String(question.get("explanation") || "").trim()) {
      contentGapCounters.withoutExplanation += 1;
    }

    if (!questionIdsWithCorrectOption.has(questionId)) {
      contentGapCounters.withoutCorrectOption += 1;
    }

    if (lastEditedAt instanceof Date && lastEditedAt >= modifiedSince) {
      recentEditedQuestions.push({
        objectId: questionId,
        question: shortenText(questionStem),
        specialty,
        topic: question.get("topic") || "Unspecified",
        status: statusLabel,
        lastEditedDate: lastEditedAt.toISOString(),
        lastEditedBy: getPointerDisplayName(question.get("lastEditedBy")) || "Unassigned",
      });
    }

    if (["needs_review", "revision_requested", "approved"].includes(statusKey)) {
      const latestReview = latestReviewByQuestionId.get(questionId);
      const waitingDate = lastEditedAt instanceof Date ? lastEditedAt : question.updatedAt;
      const daysWaiting = waitingDate
        ? Math.max(0, Math.floor((Date.now() - waitingDate.getTime()) / (24 * 60 * 60 * 1000)))
        : 0;

      reviewQueue.push({
        objectId: questionId,
        question: shortenText(questionStem),
        status: statusLabel,
        specialty,
        daysWaiting,
        assignedReviewer: getPointerDisplayName(latestReview?.get("reviewer")) || "Unassigned",
      });
    }
  });

  references.forEach((reference) => {
    const year = reference.get("year");
    if (typeof year === "number" && !Number.isNaN(year)) {
      referenceYearDistributionMap.set(year, (referenceYearDistributionMap.get(year) || 0) + 1);
    }
  });

  const recentActivity = editHistory.slice(0, RECENT_TABLE_LIMIT).map((entry) => ({
    date: (entry.get("editedAt") || entry.createdAt || new Date()).toISOString(),
    editor: getPointerDisplayName(entry.get("editor")) || "Unknown Editor",
    question: shortenText(entry.get("question")?.get("stem") || ""),
    questionObjectId: entry.get("question")?.id || "",
    changeSummary: entry.get("changeSummary") || "Edited question content.",
    previousStatus:
      statusLabelsByKey.get(normalizeStatusKey(entry.get("previousStatus"))) ||
      entry.get("previousStatus") ||
      "—",
    newStatus:
      statusLabelsByKey.get(normalizeStatusKey(entry.get("newStatus"))) ||
      entry.get("newStatus") ||
      "—",
  }));

  recentEditedQuestions.sort((left, right) => {
    return new Date(right.lastEditedDate).getTime() - new Date(left.lastEditedDate).getTime();
  });

  reviewQueue.sort((left, right) => right.daysWaiting - left.daysWaiting);

  const referenceYears = references
    .map((reference) => reference.get("year"))
    .filter((year) => typeof year === "number" && !Number.isNaN(year));

  const earliestReferenceYear = referenceYears.length ? Math.min(...referenceYears) : 0;
  const latestReferenceYear = referenceYears.length ? Math.max(...referenceYears) : 0;
  const referenceYearRange =
    earliestReferenceYear && latestReferenceYear
      ? `${earliestReferenceYear} - ${latestReferenceYear}`
      : "—";

  return {
    kpis: {
      // All question records currently stored, including published, draft, and archived content.
      totalQuestions: questions.length,
      // Questions available to learners or otherwise marked published.
      publishedQuestions: questionsByStatusMap.get(statusLabelsByKey.get("published") || "published") || 0,
      // Questions still in draft authoring state.
      draftQuestions: questionsByStatusMap.get(statusLabelsByKey.get("draft") || "draft") || 0,
      // Questions waiting for editorial review.
      needsReviewQuestions:
        questionsByStatusMap.get(statusLabelsByKey.get("needs_review") || "needs_review") || 0,
      // Questions sent back for revision.
      revisionRequestedQuestions:
        questionsByStatusMap.get(statusLabelsByKey.get("revision_requested") || "revision_requested") || 0,
      // Questions approved and effectively ready to publish.
      approvedQuestions: questionsByStatusMap.get(statusLabelsByKey.get("approved") || "approved") || 0,
      // Questions removed from normal active circulation.
      archivedQuestions: questionsByStatusMap.get(statusLabelsByKey.get("archived") || "archived") || 0,
      // Questions missing any linked references.
      questionsWithoutReferences: contentGapCounters.withoutReferences,
      // Questions that have at least one linked media row.
      questionsWithMedia: Math.max(0, questions.length - contentGapCounters.withoutMedia),
      // Count of all reference records in scope.
      totalReferences: references.length,
      // Earliest and latest publication years across references with a year value.
      referenceYearRange,
      // Count of institutions in scope.
      institutions,
      // Invitations still awaiting acceptance.
      pendingInvitations,
      // Questions edited inside the selected recent time window.
      modifiedLast30Days: recentEditedQuestions.length,
    },
    charts: {
      questionsByStatus: [...questionsByStatusMap.entries()]
        .map(([status, count]) => ({ status, count }))
        .sort((left, right) => right.count - left.count),
      questionsBySpecialty: [...questionsBySpecialtyMap.entries()]
        .map(([specialty, count]) => ({ specialty, count }))
        .sort((left, right) => right.count - left.count),
      questionsByDifficulty: [...questionsByDifficultyMap.entries()]
        .map(([difficulty, count]) => ({ difficulty, count }))
        .sort((left, right) => {
          const difficultyOrder = {
            Easy: 0,
            Medium: 1,
            Hard: 2,
            Expert: 3,
          };

          const leftOrder = difficultyOrder[left.difficulty] ?? Number.MAX_SAFE_INTEGER;
          const rightOrder = difficultyOrder[right.difficulty] ?? Number.MAX_SAFE_INTEGER;

          if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
          }

          if (left.count !== right.count) {
            return right.count - left.count;
          }

          return left.difficulty.localeCompare(right.difficulty);
        }),
      referenceYearDistribution: [...referenceYearDistributionMap.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([year, count]) => ({ year, count })),
      mediaByType: [...mediaByTypeMap.entries()].map(([mediaType, count]) => ({ mediaType, count })),
      questionsCreatedByMonth: monthBuckets.map(({ label, count }) => ({ month: label, count })),
    },
    tables: {
      recentlyEditedQuestions: recentEditedQuestions.slice(0, RECENT_TABLE_LIMIT),
      reviewQueue: reviewQueue.slice(0, RECENT_TABLE_LIMIT),
      contentGaps: [
        { label: "Questions without references", count: contentGapCounters.withoutReferences },
        { label: "Questions without media", count: contentGapCounters.withoutMedia },
        { label: "Questions without critique", count: contentGapCounters.withoutCritique },
        { label: "Questions without explanation", count: contentGapCounters.withoutExplanation },
        { label: "Questions without correct option", count: contentGapCounters.withoutCorrectOption },
      ],
      recentActivity,
    },
  };
});
