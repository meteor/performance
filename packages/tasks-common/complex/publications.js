import { Meteor } from 'meteor/meteor';
import { publishComposite } from 'meteor/reywood:publish-composite';
import { ReactiveAggregate } from 'meteor/tunguska:reactive-aggregate';
import { ComplexTasksCollection, ChecklistsCollection, CommentsCollection } from './collections';

export const registerComplexPublications = () => {
  // Publication 1: All tasks (unscoped — every client sees all users' tasks)
  Meteor.publish('complex.tasks', function () {
    if (!this.userId) return this.ready();
    return ComplexTasksCollection.find({});
  });

  // Publication 2: All checklists for a task (unscoped by user)
  Meteor.publish('complex.checklists', function ({ taskId }) {
    if (!this.userId) return this.ready();
    return ChecklistsCollection.find({ taskId });
  });

  // Publication 3: Comments + subcomments for a task (publish-composite, unscoped)
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

  // Publication 4: All tasks with nested data (publish-composite, unscoped)
  publishComposite('complex.tasksWithDetails', function () {
    if (!this.userId) return { find() { return null; } };
    return {
      find() {
        return ComplexTasksCollection.find({});
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

  // Publication 5: Reactive summary across ALL users' tasks
  Meteor.publish('complex.summary', function () {
    if (!this.userId) return this.ready();

    ReactiveAggregate(this, ComplexTasksCollection, [
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
