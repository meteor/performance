import { Meteor } from 'meteor/meteor';
import { initializeTaskCollection, registerTaskApi } from 'meteor/tasks-common';
import { Monti } from 'meteor/montiapm:agent';

if (Meteor.isProduction) {
  Monti.startContinuousProfiling();
}

Meteor.startup(() => {
  initializeTaskCollection();
  registerTaskApi();
});
