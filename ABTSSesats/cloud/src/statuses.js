const Status = Parse.Object.extend("Status");

Parse.Cloud.define("listStatuses", async () => {
  const query = new Parse.Query(Status);

  query.ascending("sortOrder");
  query.addAscending("name");
  query.select("name", "sortOrder", "isActive", "color");
  query.limit(1000);

  const statuses = await query.find({ useMasterKey: true });

  return statuses.map((status) => ({
    objectId: status.id,
    name: status.get("name") || "",
    sortOrder: status.get("sortOrder") ?? null,
    isActive: status.get("isActive") !== false,
    color: status.get("color") || "",
  }));
});
