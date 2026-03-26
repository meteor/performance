import { Meteor } from 'meteor/meteor';
import { publishComposite } from 'meteor/reywood:publish-composite';
import { ReactiveAggregate } from 'meteor/tunguska:reactive-aggregate';
import { ComplexTasksCollection, ChecklistsCollection, CommentsCollection } from './collections';

export const registerComplexPublications = () => {
  // Publication 1: User's tasks (simple)
  Meteor.publish('complex.tasks', function () {
    if (!this.userId) return this.ready();
    return ComplexTasksCollection.find({ userId: this.userId });
  });

  // Publication 2: Checklists for a specific task
  Meteor.publish('complex.checklists', function ({ taskId }) {
    if (!this.userId) return this.ready();
    return ChecklistsCollection.find({ taskId, userId: this.userId });
  });

  // Publication 3: Comments + subcomments for a task (publish-composite)
  publishComposite('complex.taskComments', function ({ taskId }) {
    if (!this.userId) return { find() { return null; } };
    return {
      find() {
        return CommentsCollection.find({ taskId, parentId: null });
      },
      children: [{
        find(comment) {
          return CommentsCollection.find({ parentId: comment._id });
        },
      }],
    };
  });

  // Publication 4: Tasks with all nested data (publish-composite)
  publishComposite('complex.tasksWithDetails', function () {
    if (!this.userId) return { find() { return null; } };
    const userId = this.userId;
    return {
      find() {
        return ComplexTasksCollection.find({ userId });
      },
      children: [
        {
          find(task) {
            return ChecklistsCollection.find({ taskId: task._id });
          },
        },
        {
          find(task) {
            return CommentsCollection.find({ taskId: task._id, parentId: null });
          },
          children: [{
            find(comment) {
              return CommentsCollection.find({ parentId: comment._id });
            },
          }],
        },
      ],
    };
  });

  // Publication 5: Reactive summary using reactive-aggregate
  Meteor.publish('complex.summary', function () {
    if (!this.userId) return this.ready();

    ReactiveAggregate(this, ComplexTasksCollection, [
      { $match: { userId: this.userId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
      {
        $addFields: {
          status: '$_id',
        },
      },
    ], { clientCollection: 'complexTasksSummary' });
  });
};
