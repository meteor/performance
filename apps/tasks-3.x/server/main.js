import { Meteor } from 'meteor/meteor';
import { initializeTaskCollection, registerTaskApi } from 'meteor/tasks-common';

Meteor.startup(() => {
  initializeTaskCollection();
  registerTaskApi();
});
