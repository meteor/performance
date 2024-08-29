import { Meteor } from 'meteor/meteor';
import { tryMonitorExtras, initializeTaskCollection, registerTaskApi } from 'meteor/tasks-common';
import { Monti } from 'meteor/montiapm:agent';

if (Meteor.isProduction) {
  Monti.startContinuousProfiling();
}

Meteor.startup(() => {
  tryMonitorExtras();
  initializeTaskCollection();
  registerTaskApi();
});
