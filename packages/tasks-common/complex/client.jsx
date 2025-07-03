import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useFind, useSubscribe } from 'meteor/react-meteor-data';
import { Random } from 'meteor/random';
import { TasksCollection, initializeTaskCollection, registerTaskApi  } from '../tasks-common';

const App = () => {
    const sessionIdRef = useRef(Random.id());
    const sessionId = sessionIdRef?.current;
    const [tasks, setTasks] = useState([]);
    const firstTask = tasks.find(_task => _task.sessionId === sessionId);
    const lastTask = [...tasks].reverse().find(_task => _task.sessionId === sessionId);

    const onAddClick = useCallback(async () => {
        const descriptionsParts = lastTask?.description?.split(' ') || [];
        const lastDescriptionNum = (parseFloat(descriptionsParts[descriptionsParts.length - 1] || '0') || 0);
        const nextTaskNum = lastDescriptionNum + 1;
        await Meteor.callAsync('insertTask', { sessionId, description: `New Task ${nextTaskNum}` });
    }, [lastTask?._id, sessionId]);
    const onRemoveClick = useCallback(async () => {
        await Meteor.callAsync('removeTask', { taskId: firstTask?._id });
    }, [ firstTask?._id]);
    const onRemoveAllClick = useCallback(async () => {
        await Meteor.callAsync('removeAllTasks', { sessionId });
    }, [sessionId]);

    return (
        <div>
            <div id="sessionIdSection" style={{ marginBottom: 8 }}>
                <span>Session: </span><span id="sessionId">{sessionId}</span>
            </div>
            <div>
                <div style={{ display: 'flex' }}>
                    <button className="add-task" onClick={onAddClick} style={{ margin: 4 }}>Add task</button>
                    <button className="remove-task" onClick={onRemoveClick} style={{ margin: 4 }}>Remove task</button>
                    <button className="remove-all-tasks" onClick={onRemoveAllClick} style={{ margin: 4 }}>Remove all tasks</button>
                </div>
                <AppReactive tasks={tasks} setTasks={setTasks} />
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
