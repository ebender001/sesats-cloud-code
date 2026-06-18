function requireString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${fieldName} is required.`);
  }

  return value.trim();
}

async function resolveUsernameForLogin(identifier) {
  if (!identifier.includes("@")) {
    return identifier;
  }

  const userQuery = new Parse.Query(Parse.User);
  userQuery.equalTo("email", identifier);
  userQuery.select("username", "email", "displayName");

  const user = await userQuery.first({ useMasterKey: true });

  if (!user) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, "Invalid username/email or password.");
  }

  return user.get("username");
}

Parse.Cloud.define("loginUser", async (request) => {
  const params = request.params || {};
  const identifier = requireString(params.identifier, "identifier");
  const password = requireString(params.password, "password");

  const username = await resolveUsernameForLogin(identifier);

  try {
    const user = await Parse.User.logIn(username, password);

    return {
      objectId: user.id,
      username: user.get("username") || "",
      email: user.get("email") || "",
      displayName: user.get("displayName") || "",
      sessionToken: user.getSessionToken(),
    };
  } catch (error) {
    if (error && error.code === Parse.Error.OBJECT_NOT_FOUND) {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, "Invalid username/email or password.");
    }

    throw error;
  }
});
