const Institution = Parse.Object.extend("Institution");

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

  const savedInstitution = await institution.save(null, { useMasterKey: true });

  return {
    objectId: savedInstitution.id,
    name: savedInstitution.get("name"),
    city: savedInstitution.get("city") || "",
  };
});

Parse.Cloud.define("editInstitution", async (request) => {
  const objectId = requireString(request.params.objectId, "objectId");
  const query = new Parse.Query(Institution);
  const institution = await query.get(objectId, { useMasterKey: true });

  applyInstitutionFields(institution, request.params || {});

  const savedInstitution = await institution.save(null, { useMasterKey: true });

  return {
    objectId: savedInstitution.id,
    name: savedInstitution.get("name"),
    city: savedInstitution.get("city") || "",
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
  query.select("name", "city");
  query.limit(1000);

  const institutions = await query.find({ useMasterKey: true });

  return institutions.map((institution) => ({
    objectId: institution.id,
    name: institution.get("name") || "",
    city: institution.get("city") || "",
  }));
});
