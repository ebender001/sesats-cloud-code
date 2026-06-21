require("./src/institutions");
require("./src/specialties");
require("./src/topics");
require("./src/auth");
require("./src/users");
require("./src/questions");

Parse.Cloud.define("hello", () => {
  return "Hello world!";
});
