import { TasksCollection } from './tasks-common.client';

export const registerTaskApi = () => {
  Meteor.methods({
    insertTask({ description }) {
      return TasksCollection.insertAsync({
        description,
        createdAt: new Date(),
      });
    },
    removeTask({ taskId }) {
      return TasksCollection.removeAsync({ _id: taskId });
    },
    removeAllTasks() {
      return TasksCollection.removeAsync({});
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
