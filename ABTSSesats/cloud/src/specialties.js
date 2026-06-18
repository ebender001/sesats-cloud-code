const Specialty = Parse.Object.extend("Specialty");

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

function normalizeOptionalNumber(value, fieldName) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${fieldName} must be a number.`);
  }

  return value;
}

function applySpecialtyFields(specialty, params, { requireName = false } = {}) {
  if (requireName || Object.prototype.hasOwnProperty.call(params, "name")) {
    specialty.set("name", requireString(params.name, "name"));
  }

  const optionalStringFields = ["shortName", "description"];

  optionalStringFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(params, field)) {
      specialty.set(field, normalizeOptionalString(params[field]));
    }
  });

  if (Object.prototype.hasOwnProperty.call(params, "sortOrder")) {
    specialty.set("sortOrder", normalizeOptionalNumber(params.sortOrder, "sortOrder"));
  }

  if (Object.prototype.hasOwnProperty.call(params, "isActive")) {
    if (typeof params.isActive !== "boolean") {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, "isActive must be a boolean.");
    }

    specialty.set("isActive", params.isActive);
  }

  if (Object.prototype.hasOwnProperty.call(params, "parentSpecialtyObjectId")) {
    if (params.parentSpecialtyObjectId === null || params.parentSpecialtyObjectId === "") {
      specialty.unset("parentSpecialty");
    } else {
      const parentSpecialtyObjectId = requireString(
        params.parentSpecialtyObjectId,
        "parentSpecialtyObjectId"
      );
      const parentSpecialty = new Specialty();
      parentSpecialty.id = parentSpecialtyObjectId;
      specialty.set("parentSpecialty", parentSpecialty);
    }
  }
}

Parse.Cloud.define("addSpecialty", async (request) => {
  const specialty = new Specialty();
  applySpecialtyFields(specialty, request.params || {}, { requireName: true });

  const savedSpecialty = await specialty.save(null, { useMasterKey: true });

  return {
    objectId: savedSpecialty.id,
    name: savedSpecialty.get("name"),
    shortName: savedSpecialty.get("shortName") || "",
  };
});

Parse.Cloud.define("editSpecialty", async (request) => {
  const objectId = requireString(request.params.objectId, "objectId");
  const query = new Parse.Query(Specialty);
  const specialty = await query.get(objectId, { useMasterKey: true });

  applySpecialtyFields(specialty, request.params || {});

  const savedSpecialty = await specialty.save(null, { useMasterKey: true });

  return {
    objectId: savedSpecialty.id,
    name: savedSpecialty.get("name"),
    shortName: savedSpecialty.get("shortName") || "",
  };
});

Parse.Cloud.define("deleteSpecialty", async (request) => {
  const objectId = requireString(request.params.objectId, "objectId");
  const query = new Parse.Query(Specialty);
  const specialty = await query.get(objectId, { useMasterKey: true });

  await specialty.destroy({ useMasterKey: true });

  return {
    objectId,
    deleted: true,
  };
});

Parse.Cloud.define("listSpecialties", async () => {
  const query = new Parse.Query(Specialty);

  query.ascending("name");
  query.select("name", "shortName");
  query.limit(1000);

  const specialties = await query.find({ useMasterKey: true });

  return specialties.map((specialty) => ({
    objectId: specialty.id,
    name: specialty.get("name") || "",
    shortName: specialty.get("shortName") || "",
  }));
});
