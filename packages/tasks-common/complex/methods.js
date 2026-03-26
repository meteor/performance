import { Meteor } from 'meteor/meteor';
import { ComplexTasksCollection, ChecklistsCollection, CommentsCollection } from './collections';

export const registerComplexApi = () => {
  Meteor.methods({
    'complex.insertTask'({ description }) {
      const userId = this.userId;
      if (!userId) throw new Meteor.Error('not-authorized');
      return ComplexTasksCollection.insertAsync({
        userId,
        description,
        status: 'pending',
        createdAt: new Date(),
      });
    },

    'complex.updateTaskStatus'({ taskId, status }) {
      const userId = this.userId;
      if (!userId) throw new Meteor.Error('not-authorized');
      return ComplexTasksCollection.updateAsync(
        { _id: taskId, userId },
        { $set: { status } }
      );
    },

    'complex.removeTask'({ taskId }) {
      const userId = this.userId;
      if (!userId) throw new Meteor.Error('not-authorized');
      return Promise.all([
        ChecklistsCollection.removeAsync({ taskId }),
        CommentsCollection.removeAsync({ taskId }),
        ComplexTasksCollection.removeAsync({ _id: taskId, userId }),
      ]);
    },

    'complex.removeAllTasks'() {
      const userId = this.userId;
      if (!userId) throw new Meteor.Error('not-authorized');
      return Promise.all([
        ChecklistsCollection.removeAsync({ userId }),
        CommentsCollection.removeAsync({ userId }),
        ComplexTasksCollection.removeAsync({ userId }),
      ]);
    },

    'complex.addChecklistItem'({ taskId, text }) {
      const userId = this.userId;
      if (!userId) throw new Meteor.Error('not-authorized');
      return ChecklistsCollection.insertAsync({
        taskId,
        userId,
        text,
        completed: false,
        createdAt: new Date(),
      });
    },

    'complex.toggleChecklistItem'({ itemId }) {
      const userId = this.userId;
      if (!userId) throw new Meteor.Error('not-authorized');
      return ChecklistsCollection.findOneAsync(itemId).then((item) => {
        return ChecklistsCollection.updateAsync(
          { _id: itemId, userId },
          { $set: { completed: !item?.completed } }
        );
      });
    },

    'complex.addComment'({ taskId, text }) {
      const userId = this.userId;
      if (!userId) throw new Meteor.Error('not-authorized');
      return CommentsCollection.insertAsync({
        taskId,
        userId,
        parentId: null,
        text,
        createdAt: new Date(),
      });
    },

    'complex.addSubComment'({ taskId, commentId, text }) {
      const userId = this.userId;
      if (!userId) throw new Meteor.Error('not-authorized');
      return CommentsCollection.insertAsync({
        taskId,
        userId,
        parentId: commentId,
        text,
        createdAt: new Date(),
      });
    },

    'complex.removeComment'({ commentId }) {
      const userId = this.userId;
      if (!userId) throw new Meteor.Error('not-authorized');
      return Promise.all([
        CommentsCollection.removeAsync({ parentId: commentId }),
        CommentsCollection.removeAsync({ _id: commentId, userId }),
      ]);
    },
  });
};
