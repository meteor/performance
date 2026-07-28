/**
 * Artillery processor for DDP-raw benchmarks.
 *
 * Each virtual user connects via DDP (SimpleDDP + ws),
 * subscribes to publications, calls methods, then disconnects.
 * No browser involved — pure server-side load testing.
 *
 * Artillery v2 beforeScenario/afterScenario hooks receive (context, events)
 * and must return a promise (no done callback).
 */

import SimpleDDP from 'simpleddp';
import ws from 'ws';
import crypto from 'node:crypto';

const TARGET = process.env.REMOTE_URL || 'http://localhost:3000';
const TASK_COUNT = parseInt(process.env.TASK_COUNT || '20', 10);

function wsUrl(httpUrl) {
  return httpUrl.replace(/^http/, 'ws') + '/websocket';
}

// ─── Self-contained scenario functions (used as beforeScenario) ──────

/**
 * Full reactive scenario: connect + subscribe + insert + remove + disconnect
 */
async function reactiveCrud(context, events) {
  const ddp = new SimpleDDP({
    endpoint: wsUrl(TARGET),
    SocketConstructor: ws,
    reconnectInterval: 5000,
  });

  await ddp.connect();
  const sessionId = crypto.randomUUID();

  // Subscribe
  const sub = ddp.subscribe('fetchTasks');
  await sub.ready();

  // Insert tasks
  const taskIds = [];
  for (let i = 0; i < TASK_COUNT; i++) {
    const taskId = await ddp.call('insertTask', {
      description: `${sessionId} DDP Task ${i + 1}`,
      sessionId,
    });
    taskIds.push(taskId);
  }

  // Remove tasks one by one
  for (const taskId of taskIds) {
    await ddp.call('removeTask', { taskId });
  }

  // Cleanup
  await ddp.call('removeAllTasks', { sessionId });
  ddp.disconnect();
}

/**
 * Non-reactive scenario: connect + methods only (no subscription) + disconnect
 */
async function nonReactiveCrud(context, events) {
  const ddp = new SimpleDDP({
    endpoint: wsUrl(TARGET),
    SocketConstructor: ws,
    reconnectInterval: 5000,
  });

  await ddp.connect();
  const sessionId = crypto.randomUUID();

  // Insert tasks (no subscription)
  const taskIds = [];
  for (let i = 0; i < TASK_COUNT; i++) {
    const taskId = await ddp.call('insertTask', {
      description: `${sessionId} DDP Task ${i + 1}`,
      sessionId,
    });
    taskIds.push(taskId);
  }

  // Remove tasks one by one
  for (const taskId of taskIds) {
    await ddp.call('removeTask', { taskId });
  }

  // Cleanup
  await ddp.call('removeAllTasks', { sessionId });
  ddp.disconnect();
}

export { reactiveCrud, nonReactiveCrud };
