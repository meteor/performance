export const TasksHistoryCollection = new Meteor.Collection('tasksHistory');
import { Meteor } from "meteor/meteor";

export const TasksCollection = new Meteor.Collection('taskCollection');

TasksCollection.allow({
  ...Meteor.isFibersDisabled && {
    insertAsync() { return true; },
    updateAsync() { return true; },
    removeAsync() { return true; },
  },
  insert() { return true; },
  update() { return true; },
  remove() { return true; },
});
