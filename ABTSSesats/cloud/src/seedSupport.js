function normalizeOptionalString(value, fieldName) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${fieldName} must be a string.`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function normalizeSeedFlag(params = {}) {
  const rawValue = params.isSeedData;

  if (rawValue === undefined || rawValue === null) {
    return false;
  }

  if (typeof rawValue !== "boolean") {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, "isSeedData must be a boolean.");
  }

  return rawValue;
}

function applySeedMetadata(target, params = {}, fallback = {}) {
  const isSeedData =
    params.isSeedData === undefined
      ? fallback.isSeedData === true
      : normalizeSeedFlag(params);

  target.set("isSeedData", isSeedData);

  const seedBatchIdValue =
    Object.prototype.hasOwnProperty.call(params, "seedBatchId")
      ? params.seedBatchId
      : fallback.seedBatchId;

  if (seedBatchIdValue === undefined) {
    if (!isSeedData) {
      target.unset("seedBatchId");
    }
    return;
  }

  if (seedBatchIdValue === null || seedBatchIdValue === "") {
    target.unset("seedBatchId");
    return;
  }

  target.set("seedBatchId", normalizeOptionalString(seedBatchIdValue, "seedBatchId"));
}

function getSeedMetadataFromObject(object) {
  return {
    isSeedData: object?.get("isSeedData") === true,
    seedBatchId: object?.get("seedBatchId") || undefined,
  };
}

module.exports = {
  applySeedMetadata,
  getSeedMetadataFromObject,
  normalizeSeedFlag,
};
