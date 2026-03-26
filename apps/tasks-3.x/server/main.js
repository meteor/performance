import { Meteor } from 'meteor/meteor';
import { tryMonitorExtras, initializeTaskCollection, registerTaskApi, registerComplexApi, registerComplexPublications } from 'meteor/tasks-common';

Meteor.startup(() => {
  tryMonitorExtras();
  initializeTaskCollection();
  registerTaskApi();
  registerComplexApi();
  registerComplexPublications();
});
