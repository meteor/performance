import { check } from 'meteor/check';
import { TasksCollection } from './tasks-common.client';
import { TasksHistoryCollection } from './tasks-collection';

export const registerTaskApi = async () => {
  Meteor.methods({
    insertTask({ description, sessionId }) {
      return TasksCollection.insertAsync({
        sessionId,
        description,
        createdAt: new Date(),
      });
    },
    async removeTask({ taskId }) {
      const task = await TasksCollection.findOneAsync({ _id: taskId });
      if (task) {
        await TasksHistoryCollection.insertAsync({ ...task, deletedAt: new Date() });
      }
      return TasksCollection.removeAsync({ _id: taskId });
    },
    async removeAllTasks({ sessionId }) {
      const tasks = await TasksCollection.find({ sessionId }).fetchAsync();
      for (const task of tasks) {
        await TasksHistoryCollection.insertAsync({ ...task, deletedAt: new Date() });
      }
      return TasksCollection.removeAsync({ sessionId });
    },
    'tasks.wasDeleted': async function (text) {
      check(text, String);
      return !!(await TasksHistoryCollection.findOneAsync({ text }));
    },
    fetchTasks() {
      return TasksCollection.find({}).fetch();
    },
    'tasks.exists': async function (text) {
      check(text, String);
      return !!(await TasksCollection.findOneAsync({ text }));
    },
  });

  if (Meteor.isServer) {
    Meteor.publish('fetchTasks', function pubFetchTasks() {
      return TasksCollection.find({});
    });
  }
};
