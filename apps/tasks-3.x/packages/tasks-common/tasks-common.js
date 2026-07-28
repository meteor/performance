import { TasksCollection  } from './tasks-collection';
import { registerTaskApi  } from './tasks-api';

function initializeTaskCollection() {
  return TasksCollection;
}

export { TasksCollection, initializeTaskCollection, registerTaskApi };
