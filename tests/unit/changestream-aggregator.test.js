import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateChangestream } from '../../runner/changestream-aggregator.js';

describe('aggregateChangestream', () => {
  test('null/undefined input → null (absence convention)', () => {
    assert.equal(aggregateChangestream(), null);
    assert.equal(aggregateChangestream(undefined), null);
    assert.equal(aggregateChangestream(null), null);
  });

  test('empty samples → null (collector ran, captured nothing)', () => {
    assert.equal(aggregateChangestream({ interval_ms: 250, samples: [] }), null);
  });

  test('non-array samples → null', () => {
    assert.equal(aggregateChangestream({ interval_ms: 250, samples: 'nope' }), null);
  });

  test('single sample → min=max=avg=end=value, by_namespace from that sample', () => {
    const r = aggregateChangestream({
      interval_ms: 250,
      samples: [{ ts: 1, cursorCount: 3, perNs: { 'meteor.tasks': 2, 'meteor.users': 1 } }],
    });
    assert.equal(r.metric, 'mongo_changestream');
    assert.equal(r.samples, 1);
    assert.equal(r.interval_ms, 250);
    assert.deepEqual(r.cursor_count, { min: 3, max: 3, avg: 3, end: 3 });
    assert.deepEqual(r.by_namespace['meteor.tasks'], { max: 2, avg: 2 });
    assert.deepEqual(r.by_namespace['meteor.users'], { max: 1, avg: 1 });
  });

  test('all-zero samples (oplog driver in use) → zeros, empty by_namespace', () => {
    const r = aggregateChangestream({
      interval_ms: 250,
      samples: [
        { ts: 1, cursorCount: 0, perNs: {} },
        { ts: 2, cursorCount: 0, perNs: {} },
      ],
    });
    assert.deepEqual(r.cursor_count, { min: 0, max: 0, avg: 0, end: 0 });
    assert.deepEqual(r.by_namespace, {});
  });

  test('mixed cursor counts → correct min/max/avg/end', () => {
    const r = aggregateChangestream({
      interval_ms: 250,
      samples: [
        { ts: 1, cursorCount: 0, perNs: {} },
        { ts: 2, cursorCount: 5, perNs: { 'meteor.tasks': 5 } },
        { ts: 3, cursorCount: 1, perNs: { 'meteor.tasks': 1 } },
      ],
    });
    assert.equal(r.cursor_count.min, 0);
    assert.equal(r.cursor_count.max, 5);
    assert.equal(r.cursor_count.avg, +((0 + 5 + 1) / 3).toFixed(1)); // 2
    assert.equal(r.cursor_count.end, 1);
  });

  test('multiple namespaces tracked independently', () => {
    const r = aggregateChangestream({
      interval_ms: 250,
      samples: [
        { ts: 1, cursorCount: 3, perNs: { 'meteor.tasks': 2, 'meteor.users': 1 } },
        { ts: 2, cursorCount: 3, perNs: { 'meteor.tasks': 2, 'meteor.users': 1 } },
      ],
    });
    assert.deepEqual(Object.keys(r.by_namespace).sort(), ['meteor.tasks', 'meteor.users']);
    assert.equal(r.by_namespace['meteor.tasks'].max, 2);
    assert.equal(r.by_namespace['meteor.users'].max, 1);
  });

  test('namespace max is max-merged across samples (highest in any single sample)', () => {
    const r = aggregateChangestream({
      interval_ms: 250,
      samples: [
        { ts: 1, cursorCount: 1, perNs: { 'meteor.tasks': 1 } },
        { ts: 2, cursorCount: 4, perNs: { 'meteor.tasks': 4 } },
        { ts: 3, cursorCount: 2, perNs: { 'meteor.tasks': 2 } },
      ],
    });
    assert.equal(r.by_namespace['meteor.tasks'].max, 4);
    // avg over all 3 samples: (1+4+2)/3 = 2.3
    assert.equal(r.by_namespace['meteor.tasks'].avg, +((1 + 4 + 2) / 3).toFixed(1));
  });

  test('namespace avg counts samples where the ns is absent as 0', () => {
    // tasks appears in 1 of 2 samples with count 4 → avg = 4/2 = 2.0
    const r = aggregateChangestream({
      interval_ms: 250,
      samples: [
        { ts: 1, cursorCount: 4, perNs: { 'meteor.tasks': 4 } },
        { ts: 2, cursorCount: 0, perNs: {} },
      ],
    });
    assert.equal(r.by_namespace['meteor.tasks'].max, 4);
    assert.equal(r.by_namespace['meteor.tasks'].avg, 2);
  });

  test('missing perNs on a sample is treated as no namespaces', () => {
    const r = aggregateChangestream({
      interval_ms: 250,
      samples: [
        { ts: 1, cursorCount: 0 }, // no perNs key
        { ts: 2, cursorCount: 1, perNs: { 'meteor.tasks': 1 } },
      ],
    });
    assert.equal(r.cursor_count.max, 1);
    assert.equal(r.by_namespace['meteor.tasks'].max, 1);
    assert.equal(r.by_namespace['meteor.tasks'].avg, 0.5);
  });

  test('shape contract: top-level keys exactly as the dashboard reads', () => {
    const r = aggregateChangestream({
      interval_ms: 250,
      samples: [{ ts: 1, cursorCount: 1, perNs: { 'meteor.tasks': 1 } }],
    });
    assert.deepEqual(Object.keys(r).sort(), [
      'by_namespace', 'cursor_count', 'interval_ms', 'metric', 'samples',
    ]);
    assert.deepEqual(Object.keys(r.cursor_count).sort(), ['avg', 'end', 'max', 'min']);
    assert.deepEqual(Object.keys(r.by_namespace['meteor.tasks']).sort(), ['avg', 'max']);
  });

  test('string-valued counts coerced via Number()', () => {
    const r = aggregateChangestream({
      interval_ms: 250,
      samples: [{ ts: 1, cursorCount: '3', perNs: { 'meteor.tasks': '3' } }],
    });
    assert.equal(r.cursor_count.max, 3);
    assert.equal(r.by_namespace['meteor.tasks'].max, 3);
  });

  test('namespace keys with dots (db.collection) survive intact', () => {
    const r = aggregateChangestream({
      interval_ms: 250,
      samples: [{ ts: 1, cursorCount: 1, perNs: { 'meteor.tasks.sub': 1 } }],
    });
    assert.equal(r.by_namespace['meteor.tasks.sub'].max, 1);
  });
});
