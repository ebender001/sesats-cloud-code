const Institution = Parse.Object.extend("Institution");
const GENERIC_INSTITUTION_TERMS = new Set([
  "and",
  "at",
  "center",
  "centre",
  "clinic",
  "college",
  "for",
  "health",
  "healthcare",
  "hospital",
  "institute",
  "medical",
  "medicine",
  "of",
  "school",
  "system",
  "systems",
  "the",
  "university",
]);

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

function requireString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${fieldName} is required.`);
  }

  return value.trim();
}

function normalizeInstitutionName(name) {
  if (typeof name !== "string") {
    return "";
  }

  return name
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildInstitutionNameKeys(name) {
  const normalized = normalizeInstitutionName(name);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const significantTokens = tokens.filter((token) => !GENERIC_INSTITUTION_TERMS.has(token));
  const keys = new Set();

  if (tokens.length > 0) {
    keys.add(tokens.join(" "));
    keys.add([...tokens].sort().join(" "));
  }

  if (significantTokens.length > 0) {
    keys.add(significantTokens.join(" "));
    keys.add([...significantTokens].sort().join(" "));
  }

  return keys;
}

function namesLookLikeDuplicates(candidateName, existingName) {
  const candidateKeys = buildInstitutionNameKeys(candidateName);
  const existingKeys = buildInstitutionNameKeys(existingName);

  for (const key of candidateKeys) {
    if (existingKeys.has(key)) {
      return true;
    }
  }

  return false;
}

async function findDuplicateInstitutionByName(name, { excludeObjectId } = {}) {
  const query = new Parse.Query(Institution);
  query.select("name");
  query.limit(1000);

  const institutions = await query.find({ useMasterKey: true });

  return (
    institutions.find((institution) => {
      if (excludeObjectId && institution.id === excludeObjectId) {
        return false;
      }

      return namesLookLikeDuplicates(name, institution.get("name") || "");
    }) || null
  );
}

function applyInstitutionFields(institution, params, { requireName = false } = {}) {
  if (requireName || Object.prototype.hasOwnProperty.call(params, "name")) {
    institution.set("name", requireString(params.name, "name"));
  }

  const optionalFields = [
    "institutionType",
    "city",
    "stateProvince",
    "country",
    "website",
    "contactEmail",
  ];

  optionalFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(params, field)) {
      institution.set(field, normalizeOptionalString(params[field]));
    }
  });

  if (Object.prototype.hasOwnProperty.call(params, "isActive")) {
    if (typeof params.isActive !== "boolean") {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, "isActive must be a boolean.");
    }

    institution.set("isActive", params.isActive);
  }
}

Parse.Cloud.define("addInstitution", async (request) => {
  const institution = new Institution();
  applyInstitutionFields(institution, request.params || {}, { requireName: true });

  const duplicateInstitution = await findDuplicateInstitutionByName(institution.get("name"));
  if (duplicateInstitution) {
    throw new Parse.Error(
      Parse.Error.VALIDATION_ERROR,
      `An institution named "${duplicateInstitution.get("name")}" already exists or is too similar.`
    );
  }

  const savedInstitution = await institution.save(null, { useMasterKey: true });

  return {
    objectId: savedInstitution.id,
    ...savedInstitution.toJSON(),
  };
});

Parse.Cloud.define("editInstitution", async (request) => {
  const objectId = requireString(request.params.objectId, "objectId");
  const query = new Parse.Query(Institution);
  const institution = await query.get(objectId, { useMasterKey: true });

  applyInstitutionFields(institution, request.params || {});

  const duplicateInstitution = await findDuplicateInstitutionByName(institution.get("name"), {
    excludeObjectId: objectId,
  });
  if (duplicateInstitution) {
    throw new Parse.Error(
      Parse.Error.VALIDATION_ERROR,
      `An institution named "${duplicateInstitution.get("name")}" already exists or is too similar.`
    );
  }

  const savedInstitution = await institution.save(null, { useMasterKey: true });

  return {
    objectId: savedInstitution.id,
    ...savedInstitution.toJSON(),
  };
});

Parse.Cloud.define("deleteInstitution", async (request) => {
  const objectId = requireString(request.params.objectId, "objectId");
  const query = new Parse.Query(Institution);
  const institution = await query.get(objectId, { useMasterKey: true });

  await institution.destroy({ useMasterKey: true });

  return {
    objectId,
    deleted: true,
  };
});

Parse.Cloud.define("listInstitutions", async () => {
  const query = new Parse.Query(Institution);

  query.ascending("name");
  query.limit(1000);

  const institutions = await query.find({ useMasterKey: true });

  return institutions.map((institution) => {
    const institutionData = institution.toJSON();

    return {
      objectId: institution.id,
      ...institutionData,
    };
  });
});
