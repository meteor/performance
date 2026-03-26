import { Meteor } from 'meteor/meteor';

export const ComplexTasksCollection = new Meteor.Collection('complexTasks');
export const ChecklistsCollection = new Meteor.Collection('checklists');
export const CommentsCollection = new Meteor.Collection('comments');

const allowAll = {
  ...(Meteor.isFibersDisabled && {
    insertAsync() { return true; },
    updateAsync() { return true; },
    removeAsync() { return true; },
  }),
  insert() { return true; },
  update() { return true; },
  remove() { return true; },
};

ComplexTasksCollection.allow(allowAll);
ChecklistsCollection.allow(allowAll);
CommentsCollection.allow(allowAll);
