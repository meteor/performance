import { Meteor } from 'meteor/meteor';
import { tryMonitorExtras, initializeTaskCollection, registerTaskApi } from 'meteor/tasks-common';

Meteor.startup(() => {
  tryMonitorExtras();
  initializeTaskCollection();
  registerTaskApi();
});
