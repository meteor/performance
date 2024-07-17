// Import Tinytest from the tinytest Meteor package.
import { Tinytest } from "meteor/tinytest";

// Import and rename a variable exported by tasks-common.js.
import { name as packageName } from "meteor/tasks-common";

// Write your tests here!
// Here is an example.
Tinytest.add('tasks-common - example', function (test) {
  test.equal(packageName, "tasks-common");
});
