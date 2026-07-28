import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateIndexUsage } from '../../runner/index-usage-aggregator.js';

// $indexStats row factory. accesses.ops is the lifetime counter; since is
// when Mongo began tracking (a BSON Date in prod, a Date or ISO string here).
function idx(name, ops, { since = '2026-06-02T12:00:00.000Z', key } = {}) {
  return { name, accesses: { ops, since }, key: key ?? { [name.replace(/_-?1$/, '')]: 1 } };
}

describe('aggregateIndexUsage', () => {
  test('two snapshots, same indexes → ops_in_window = end - start per index', () => {
    const start = { tasks: [idx('_id_', 100), idx('sessionId_1', 1000)] };
    const end = { tasks: [idx('_id_', 4620), idx('sessionId_1', 2850)] };
    const r = aggregateIndexUsage({ start, end, collections: ['tasks'] });
    assert.equal(r.metric, 'mongo_index_usage');
    const byName = Object.fromEntries(r.collections.tasks.map((x) => [x.name, x.ops_in_window]));
    assert.equal(byName._id_, 4520);
    assert.equal(byName.sessionId_1, 1850);
  });

  test('never-used index (start === end) → ops_in_window 0, row KEPT', () => {
    const start = { tasks: [idx('_id_', 500), idx('createdAt_-1', 42)] };
    const end = { tasks: [idx('_id_', 900), idx('createdAt_-1', 42)] };
    const r = aggregateIndexUsage({ start, end, collections: ['tasks'] });
    const dead = r.collections.tasks.find((x) => x.name === 'createdAt_-1');
    assert.ok(dead, 'unused index should still appear');
    assert.equal(dead.ops_in_window, 0);
  });

  test('index in end but not start (created mid-run) → treated as start 0', () => {
    const start = { tasks: [idx('_id_', 100)] };
    const end = { tasks: [idx('_id_', 150), idx('newIndex_1', 30)] };
    const r = aggregateIndexUsage({ start, end, collections: ['tasks'] });
    const created = r.collections.tasks.find((x) => x.name === 'newIndex_1');
    assert.equal(created.ops_in_window, 30);
  });

  test('index in start but not end (dropped mid-run) → omitted from output', () => {
    const start = { tasks: [idx('_id_', 100), idx('staleIndex_1', 77)] };
    const end = { tasks: [idx('_id_', 200)] };
    const r = aggregateIndexUsage({ start, end, collections: ['tasks'] });
    assert.equal(r.collections.tasks.length, 1);
    assert.equal(r.collections.tasks[0].name, '_id_');
  });

  test('counter reset (end < start) → ops_in_window = end (server restart)', () => {
    const start = { tasks: [idx('_id_', 5000)] };
    const end = { tasks: [idx('_id_', 200)] };
    const r = aggregateIndexUsage({ start, end, collections: ['tasks'] });
    assert.equal(r.collections.tasks[0].ops_in_window, 200);
  });

  test('multiple collections each aggregated independently', () => {
    const start = { tasks: [idx('_id_', 10)], sessions: [idx('_id_', 5)] };
    const end = { tasks: [idx('_id_', 60)], sessions: [idx('_id_', 25)] };
    const r = aggregateIndexUsage({ start, end, collections: ['tasks', 'sessions'] });
    assert.equal(r.collections.tasks[0].ops_in_window, 50);
    assert.equal(r.collections.sessions[0].ops_in_window, 20);
  });

  test('since is emitted as an ISO string', () => {
    const start = { tasks: [idx('_id_', 0, { since: '2026-06-02T12:00:00.000Z' })] };
    const end = { tasks: [idx('_id_', 1, { since: '2026-06-02T12:00:00.000Z' })] };
    const r = aggregateIndexUsage({ start, end, collections: ['tasks'] });
    assert.equal(r.collections.tasks[0].since, '2026-06-02T12:00:00.000Z');
  });

  test('since given as a Date is coerced to ISO string', () => {
    const d = new Date('2026-06-02T08:30:00.000Z');
    const r = aggregateIndexUsage({
      start: { tasks: [idx('_id_', 0, { since: d })] },
      end: { tasks: [idx('_id_', 1, { since: d })] },
      collections: ['tasks'],
    });
    assert.equal(r.collections.tasks[0].since, '2026-06-02T08:30:00.000Z');
  });

  test('key is passed through verbatim for compound indexes', () => {
    const key = { sessionId: 1, createdAt: -1 };
    const r = aggregateIndexUsage({
      start: { tasks: [idx('sessionId_1_createdAt_-1', 0, { key })] },
      end: { tasks: [idx('sessionId_1_createdAt_-1', 12, { key })] },
      collections: ['tasks'],
    });
    assert.deepEqual(r.collections.tasks[0].key, key);
  });

  test('empty input → null (absence convention CC-5)', () => {
    assert.equal(aggregateIndexUsage({ start: {}, end: {}, collections: [] }), null);
    assert.equal(aggregateIndexUsage({}), null);
    assert.equal(aggregateIndexUsage(), null);
  });

  test('collection listed but with no end rows → excluded, contributes no key', () => {
    const r = aggregateIndexUsage({
      start: { tasks: [idx('_id_', 1)] },
      end: { tasks: [], sessions: [idx('_id_', 9)] },
      collections: ['tasks', 'sessions'],
    });
    assert.equal(r.collections.tasks, undefined);
    assert.ok(r.collections.sessions);
  });

  test('collections defaults to end snapshot keys when not provided', () => {
    const r = aggregateIndexUsage({
      start: { tasks: [idx('_id_', 0)] },
      end: { tasks: [idx('_id_', 7)] },
    });
    assert.equal(r.collections.tasks[0].ops_in_window, 7);
  });

  test('missing accesses.ops coerces to 0 (defensive)', () => {
    const start = { tasks: [{ name: '_id_', accesses: { since: '2026-06-02T12:00:00.000Z' }, key: { _id: 1 } }] };
    const end = { tasks: [{ name: '_id_', accesses: { ops: 5, since: '2026-06-02T12:00:00.000Z' }, key: { _id: 1 } }] };
    const r = aggregateIndexUsage({ start, end, collections: ['tasks'] });
    assert.equal(r.collections.tasks[0].ops_in_window, 5);
  });
});
