import { TasksCollection } from './tasks-common.client';

export const registerTaskApi = () => {
  Meteor.methods({
    insertTask({ description, sessionId }) {
      return TasksCollection.insertAsync({
        sessionId,
        description,
        createdAt: new Date(),
      });
    },
    removeTask({ taskId }) {
      return TasksCollection.removeAsync({ _id: taskId });
    },
    removeAllTasks({ sessionId }) {
      return TasksCollection.removeAsync({ sessionId });
    },
    fetchTasks() {
      return TasksCollection.find({}).fetch();
    },
  });

  if (Meteor.isServer) {
    Meteor.publish('fetchTasks', function pubFetchTasks() {
      return TasksCollection.find({});
    });
  }
};
