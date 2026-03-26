import React, { useCallback, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker, useFind, useSubscribe } from 'meteor/react-meteor-data';
import { Accounts } from 'meteor/accounts-base';
import { Random } from 'meteor/random';
import { ComplexTasksCollection, ChecklistsCollection, CommentsCollection } from './collections';

// Summary collection (client-only, populated by reactive-aggregate)
const SummaryCollection = new Meteor.Collection('complexTasksSummary');

// ── Auth ──────────────────────────────────────────────────────
const AuthGate = ({ children }) => {
  const user = useTracker(() => Meteor.user());
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState(null);

  const handleRegister = useCallback(async () => {
    setLoggingIn(true);
    setError(null);
    const username = `user_${Random.id(8)}`;
    const password = 'bench1234';
    try {
      await Accounts.createUserAsync({ username, password });
    } catch (err) {
      setError(err.message);
    }
    setLoggingIn(false);
  }, []);

  if (user) return children;

  return (
    <div>
      <p id="auth-status">Not logged in</p>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <button id="register-btn" onClick={handleRegister} disabled={loggingIn}>
        {loggingIn ? 'Registering...' : 'Register & Login'}
      </button>
    </div>
  );
};

// ── Summary ───────────────────────────────────────────────────
const Summary = () => {
  const isLoading = useSubscribe('complex.summary');
  const summaryData = useFind(() => SummaryCollection.find());

  if (isLoading()) return <div>Loading summary...</div>;

  return (
    <div id="summary-section">
      <h3>Summary</h3>
      <ul>
        {summaryData.map((item) => (
          <li key={item.status} className={`summary-${item.status}`}>
            {item.status}: {item.count}
          </li>
        ))}
      </ul>
    </div>
  );
};

// ── Checklist ─────────────────────────────────────────────────
const ChecklistSection = ({ taskId }) => {
  const isLoading = useSubscribe('complex.checklists', { taskId });
  const items = useFind(() => ChecklistsCollection.find({ taskId }));
  const [counter, setCounter] = useState(0);

  const handleAdd = useCallback(async () => {
    const next = counter + 1;
    setCounter(next);
    await Meteor.callAsync('complex.addChecklistItem', {
      taskId,
      text: `Item ${next}`,
    });
  }, [taskId, counter]);

  const handleToggle = useCallback(async (itemId) => {
    await Meteor.callAsync('complex.toggleChecklistItem', { itemId });
  }, []);

  if (isLoading()) return <div>Loading checklist...</div>;

  return (
    <div className="checklist-section" style={{ marginLeft: 16 }}>
      <button className="add-checklist-item" onClick={handleAdd}>+ Checklist</button>
      <ul>
        {items.map((item) => (
          <li key={item._id} className={`checklist-item ${item.completed ? 'completed' : ''}`}>
            <label>
              <input
                type="checkbox"
                checked={item.completed}
                onChange={() => handleToggle(item._id)}
              />
              {item.text}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ── Comments ──────────────────────────────────────────────────
const CommentsSection = ({ taskId }) => {
  const isLoading = useSubscribe('complex.taskComments', { taskId });
  const topComments = useFind(() => CommentsCollection.find({ taskId, parentId: null }));
  const [counter, setCounter] = useState(0);

  const handleAddComment = useCallback(async () => {
    const next = counter + 1;
    setCounter(next);
    await Meteor.callAsync('complex.addComment', {
      taskId,
      text: `Comment ${next}`,
    });
  }, [taskId, counter]);

  if (isLoading()) return <div>Loading comments...</div>;

  return (
    <div className="comments-section" style={{ marginLeft: 16 }}>
      <button className="add-comment" onClick={handleAddComment}>+ Comment</button>
      <ul>
        {topComments.map((comment) => (
          <CommentItem key={comment._id} comment={comment} taskId={taskId} />
        ))}
      </ul>
    </div>
  );
};

const CommentItem = ({ comment, taskId }) => {
  const subComments = useFind(() => CommentsCollection.find({ parentId: comment._id }));
  const [subCounter, setSubCounter] = useState(0);

  const handleAddSub = useCallback(async () => {
    const next = subCounter + 1;
    setSubCounter(next);
    await Meteor.callAsync('complex.addSubComment', {
      taskId,
      commentId: comment._id,
      text: `Reply ${next}`,
    });
  }, [taskId, comment._id, subCounter]);

  return (
    <li className="comment-item">
      <span>{comment.text}</span>
      <button className="add-subcomment" onClick={handleAddSub} style={{ marginLeft: 8 }}>Reply</button>
      {subComments.length > 0 && (
        <ul>
          {subComments.map((sub) => (
            <li key={sub._id} className="subcomment-item">{sub.text}</li>
          ))}
        </ul>
      )}
    </li>
  );
};

// ── Task Row ──────────────────────────────────────────────────
const STATUSES = ['pending', 'in-progress', 'done'];

const TaskRow = ({ task }) => {
  const [expanded, setExpanded] = useState(false);

  const handleStatusChange = useCallback(async (newStatus) => {
    await Meteor.callAsync('complex.updateTaskStatus', {
      taskId: task._id,
      status: newStatus,
    });
  }, [task._id]);

  const handleRemove = useCallback(async () => {
    await Meteor.callAsync('complex.removeTask', { taskId: task._id });
  }, [task._id]);

  const nextStatus = STATUSES[(STATUSES.indexOf(task.status) + 1) % STATUSES.length];

  return (
    <li className={`complex-task status-${task.status}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="task-description">{task.description}</span>
        <span className="task-status">[{task.status}]</span>
        <button className="cycle-status" onClick={() => handleStatusChange(nextStatus)}>
          &rarr; {nextStatus}
        </button>
        <button className="remove-single-task" onClick={handleRemove}>Remove</button>
        <button className="toggle-details" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {expanded && (
        <div>
          <ChecklistSection taskId={task._id} />
          <CommentsSection taskId={task._id} />
        </div>
      )}
    </li>
  );
};

// ── Main App ──────────────────────────────────────────────────
const ComplexDashboard = () => {
  const isLoading = useSubscribe('complex.tasks');
  const tasks = useFind(() => ComplexTasksCollection.find({}, { sort: { createdAt: 1 } }));
  const [taskCounter, setTaskCounter] = useState(0);

  const handleAddTask = useCallback(async () => {
    const next = taskCounter + 1;
    setTaskCounter(next);
    await Meteor.callAsync('complex.insertTask', {
      description: `Task ${next}`,
    });
  }, [taskCounter]);

  const handleRemoveAll = useCallback(async () => {
    await Meteor.callAsync('complex.removeAllTasks');
  }, []);

  const handleLogout = useCallback(async () => {
    await Meteor.logout();
  }, []);

  if (isLoading()) return <div>Loading...</div>;

  return (
    <div>
      <div id="user-section" style={{ marginBottom: 8 }}>
        <span>User: </span>
        <span id="username">{Meteor.user()?.username}</span>
        <button id="logout-btn" onClick={handleLogout} style={{ marginLeft: 8 }}>Logout</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button className="add-task" onClick={handleAddTask}>Add task</button>
        <button className="remove-all-tasks" onClick={handleRemoveAll}>Remove all tasks</button>
      </div>
      <Summary />
      <ul id="task-list">
        {tasks.map((task) => (
          <TaskRow key={task._id} task={task} />
        ))}
      </ul>
    </div>
  );
};

const App = () => (
  <AuthGate>
    <ComplexDashboard />
  </AuthGate>
);

export { App };
