import { TasksCollection  } from './tasks-collection';
import { registerTaskApi  } from './tasks-api';
import { ComplexTasksCollection, ChecklistsCollection, CommentsCollection } from './complex/collections';
import { registerComplexApi } from './complex/methods';

function initializeTaskCollection() {
  return TasksCollection;
}

export {
  TasksCollection, initializeTaskCollection, registerTaskApi,
  ComplexTasksCollection, ChecklistsCollection, CommentsCollection,
  registerComplexApi,
};
