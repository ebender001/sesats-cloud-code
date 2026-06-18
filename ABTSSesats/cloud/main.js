require("./src/institutions");
require("./src/specialties");
require("./src/auth");
require("./src/questions");

Parse.Cloud.define("hello", () => {
  return "Hello world!";
});
