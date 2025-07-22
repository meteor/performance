import { TasksCollection, initializeTaskCollection, registerTaskApi  } from './tasks-common';
import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useFind, useSubscribe } from 'meteor/react-meteor-data';
import { Random } from 'meteor/random';

const App = () => {
  const sessionIdRef = useRef(Random.id());
  const sessionId = sessionIdRef?.current;

  const [reactive, setReactive] = useState(true);
  const [tasks, setTasks] = useState([]);
  const onToggleReactive = useCallback(() => {
    setReactive(!reactive);
    setTasks([]);
  }, [reactive]);
  const firstTask = tasks.find(_task => _task.sessionId === sessionId);
  const lastTask = [...tasks].reverse().find(_task => _task.sessionId === sessionId);

  const onAction = useCallback(async () => {
    if (!reactive) {
      await fetchTasks();
    }
  }, [reactive]);

  const onAddClick = useCallback(async () => {
    const descriptionsParts = lastTask?.description?.split(' ') || [];
    const lastDescriptionNum = (parseFloat(descriptionsParts[descriptionsParts.length - 1] || '0') || 0);
    const nextTaskNum = lastDescriptionNum + 1;
    await Meteor.callAsync('insertTask', { sessionId, description: `New Task ${nextTaskNum}` });
    onAction();
  }, [onAction, lastTask?._id, sessionId]);
  const onRemoveClick = useCallback(async () => {
    await Meteor.callAsync('removeTask', { taskId: firstTask?._id });
    onAction();
  }, [onAction, firstTask?._id]);
  const onRemoveAllClick = useCallback(async () => {
    await Meteor.callAsync('removeAllTasks', { sessionId });
    onAction();
  }, [onAction, sessionId]);

  const fetchTasks = useCallback(async () => {
    if (reactive) return;
    setTasks(await Meteor.callAsync('fetchTasks'));
  }, [reactive, tasks.length]);

  return (
    <div>
      <div id="sessionIdSection" style={{ marginBottom: 8 }}>
        <span>Session: </span><span id="sessionId">{sessionId}</span>
      </div>
      <div style={{ display: 'flex' }}>
        <div>
          <input type="radio" id="reactive" name="reactive" onChange={onToggleReactive} checked={reactive} />
          <label htmlFor="reactive">Reactive</label>
        </div>
        <div>
          <input type="radio" id="no-reactive" name="no-reactive" onChange={onToggleReactive} checked={!reactive} />
          <label htmlFor="no-reactive">No Reactive</label>
        </div>
      </div>
      <div>
        <div style={{ display: 'flex' }}>
          <button className="add-task" onClick={onAddClick} style={{ margin: 4 }}>Add task</button>
          <button className="remove-task" onClick={onRemoveClick} style={{ margin: 4 }}>Remove task</button>
          <button className="remove-all-tasks" onClick={onRemoveAllClick} style={{ margin: 4 }}>Remove all tasks</button>
        </div>
        {reactive ? <AppReactive tasks={tasks} setTasks={setTasks} /> : <AppNonReactive tasks={tasks} setTasks={setTasks} fetchTasks={fetchTasks} />}
      </div>
    </div>
  );
};

const AppReactive = ({ tasks, setTasks }) => {
  const isLoading = useSubscribe('fetchTasks');
  const trackerTasks = useFind(() => TasksCollection.find());
  useEffect(() => {
    setTasks(trackerTasks);
  }, [trackerTasks?.length]);
  if (isLoading()) {
    return <div>Loading...</div>;
  }
  return <TasksList tasks={tasks} />;
};


const AppNonReactive = ({ tasks, fetchTasks }) => {
  useEffect(() => {
    fetchTasks();
  }, []);
  return <TasksList tasks={tasks} />;
};

const TasksList = ({ tasks }) => {
  return (
    <ul>
      {tasks.map(task => {
        return (
          <li key={task._id}>{`${task.sessionId || ''} ${task.description}`}</li>
        );
      })}
    </ul>
  );
};

export { TasksCollection, initializeTaskCollection, registerTaskApi, App };
