require("./src/institutions");
require("./src/specialties");
require("./src/statuses");
require("./src/topics");
require("./src/auth");
require("./src/users");
require("./src/questions");
require("./src/questionGeneration");

Parse.Cloud.define("hello", () => {
  return "Hello world!";
});
