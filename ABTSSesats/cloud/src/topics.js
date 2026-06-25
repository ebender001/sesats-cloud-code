const Topic = Parse.Object.extend("Topic");
const Specialty = Parse.Object.extend("Specialty");
const { applySeedMetadata } = require("./seedSupport");

function requireString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${fieldName} is required.`);
  }

  return value.trim();
}

function normalizeTopicName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

Parse.Cloud.define("listTopics", async (request) => {
  const params = request.params || {};
  const query = new Parse.Query(Topic);

  if (Object.prototype.hasOwnProperty.call(params, "specialtyObjectId")) {
    const specialtyObjectId = requireString(params.specialtyObjectId, "specialtyObjectId");
    query.equalTo("specialtyObjectId", specialtyObjectId);
  }

  query.ascending("name");
  query.select("name", "specialtyObjectId");
  query.limit(1000);

  const topics = await query.find({ useMasterKey: true });

  return topics.map((topic) => ({
    objectId: topic.id,
    name: topic.get("name") || "",
    specialtyObjectId: topic.get("specialtyObjectId") || "",
  }));
});

Parse.Cloud.define("addTopic", async (request) => {
  const params = request.params || {};
  const name = requireString(params.name, "name").replace(/\s+/g, " ");
  const specialtyObjectId = requireString(params.specialtyObjectId, "specialtyObjectId");
  const normalizedName = normalizeTopicName(name);

  const existingQuery = new Parse.Query(Topic);
  existingQuery.equalTo("specialtyObjectId", specialtyObjectId);
  existingQuery.select("name", "specialtyObjectId");
  existingQuery.limit(1000);

  const existingTopics = await existingQuery.find({ useMasterKey: true });
  const existingTopic = existingTopics.find(
    (topic) => normalizeTopicName(topic.get("name")) === normalizedName
  );
  if (existingTopic) {
    return {
      objectId: existingTopic.id,
      name: existingTopic.get("name") || "",
      specialtyObjectId: existingTopic.get("specialtyObjectId") || "",
      created: false,
    };
  }

  const specialty = new Specialty();
  specialty.id = specialtyObjectId;

  const topic = new Topic();
  topic.set("name", name);
  topic.set("specialtyObjectId", specialtyObjectId);
  topic.set("specialty", specialty);
  applySeedMetadata(topic, params);

  const savedTopic = await topic.save(null, { useMasterKey: true });

  return {
    objectId: savedTopic.id,
    name: savedTopic.get("name") || "",
    specialtyObjectId: savedTopic.get("specialtyObjectId") || "",
    created: true,
  };
});

Parse.Cloud.define("syncSubsetTopics", async (request) => {
  const params = request.params || {};
  const targetSpecialtyObjectId = requireString(
    params.targetSpecialtyObjectId,
    "targetSpecialtyObjectId"
  );
  const sourceSpecialtyObjectId = requireString(
    params.sourceSpecialtyObjectId,
    "sourceSpecialtyObjectId"
  );
  const excludedSpecialtyObjectId = params.excludedSpecialtyObjectId
    ? requireString(params.excludedSpecialtyObjectId, "excludedSpecialtyObjectId")
    : "";

  const [sourceTopics, excludedTopics, targetTopics] = await Promise.all([
    new Parse.Query(Topic)
      .equalTo("specialtyObjectId", sourceSpecialtyObjectId)
      .ascending("name")
      .limit(1000)
      .find({ useMasterKey: true }),
    excludedSpecialtyObjectId
      ? new Parse.Query(Topic)
          .equalTo("specialtyObjectId", excludedSpecialtyObjectId)
          .ascending("name")
          .limit(1000)
          .find({ useMasterKey: true })
      : Promise.resolve([]),
    new Parse.Query(Topic)
      .equalTo("specialtyObjectId", targetSpecialtyObjectId)
      .ascending("name")
      .limit(1000)
      .find({ useMasterKey: true }),
  ]);

  const excludedNames = new Set(
    excludedTopics.map((topic) => normalizeTopicName(topic.get("name")))
  );
  const existingTargetNames = new Set(
    targetTopics.map((topic) => normalizeTopicName(topic.get("name")))
  );

  const targetSpecialty = new Specialty();
  targetSpecialty.id = targetSpecialtyObjectId;

  const topicsToCreate = sourceTopics
    .map((topic) => String(topic.get("name") || "").trim().replace(/\s+/g, " "))
    .filter((name) => name.length > 0)
    .filter((name) => !excludedNames.has(normalizeTopicName(name)))
    .filter((name) => !existingTargetNames.has(normalizeTopicName(name)))
    .map((name) => {
      const topic = new Topic();
      topic.set("name", name);
      topic.set("specialtyObjectId", targetSpecialtyObjectId);
      topic.set("specialty", targetSpecialty);
      applySeedMetadata(topic, { isSeedData: false });
      return topic;
    });

  if (topicsToCreate.length > 0) {
    await Parse.Object.saveAll(topicsToCreate, { useMasterKey: true });
  }

  return {
    targetSpecialtyObjectId,
    createdCount: topicsToCreate.length,
  };
});
