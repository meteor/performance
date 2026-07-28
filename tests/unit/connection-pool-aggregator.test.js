import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateConnectionPool } from '../../runner/connection-pool-aggregator.js';

describe('aggregateConnectionPool', () => {
  test('null/undefined input → null (absence convention)', () => {
    assert.equal(aggregateConnectionPool(), null);
    assert.equal(aggregateConnectionPool(undefined), null);
    assert.equal(aggregateConnectionPool(null), null);
  });

  test('empty samples → null (collector ran, captured nothing)', () => {
    assert.equal(
      aggregateConnectionPool({ interval_ms: 1000, samples: [], total_created_start: 5, total_created_end: 5 }),
      null,
    );
  });

  test('non-array samples → null', () => {
    assert.equal(aggregateConnectionPool({ interval_ms: 1000, samples: 'nope' }), null);
  });

  test('single sample → min=max=avg=end=value for current and active', () => {
    const r = aggregateConnectionPool({
      interval_ms: 1000,
      samples: [{ ts: 1, current: 4, active: 2 }],
      total_created_start: 8,
      total_created_end: 8,
    });
    assert.equal(r.metric, 'mongo_pool');
    assert.equal(r.samples, 1);
    assert.equal(r.interval_ms, 1000);
    assert.deepEqual(r.current, { min: 4, max: 4, avg: 4, end: 4 });
    assert.deepEqual(r.active, { min: 2, max: 2, avg: 2, end: 2 });
    assert.deepEqual(r.total_created, { start: 8, end: 8, delta: 0 });
  });

  test('mixed samples → correct min/max/avg/end', () => {
    const r = aggregateConnectionPool({
      interval_ms: 1000,
      samples: [
        { ts: 1, current: 1, active: 0 },
        { ts: 2, current: 8, active: 7 },
        { ts: 3, current: 3, active: 2 },
      ],
      total_created_start: 8,
      total_created_end: 14,
    });
    assert.equal(r.samples, 3);
    assert.equal(r.current.min, 1);
    assert.equal(r.current.max, 8);
    assert.equal(r.current.avg, +((1 + 8 + 3) / 3).toFixed(1)); // 4
    assert.equal(r.current.end, 3);
    assert.equal(r.active.min, 0);
    assert.equal(r.active.max, 7);
    assert.equal(r.active.end, 2);
  });

  test('total_created delta = end - start regardless of intermediate fluctuation', () => {
    // Counter is monotonic at the source; aggregator only uses start+end.
    const r = aggregateConnectionPool({
      interval_ms: 1000,
      samples: [
        { ts: 1, current: 2, active: 1 },
        { ts: 2, current: 2, active: 1 },
        { ts: 3, current: 2, active: 1 },
      ],
      total_created_start: 5,
      total_created_end: 12,
    });
    assert.deepEqual(r.total_created, { start: 5, end: 12, delta: 7 });
  });

  test('missing total_created (null) → coerced to 0, delta 0', () => {
    const r = aggregateConnectionPool({
      interval_ms: 1000,
      samples: [{ ts: 1, current: 1, active: 0 }],
      total_created_start: null,
      total_created_end: null,
    });
    assert.deepEqual(r.total_created, { start: 0, end: 0, delta: 0 });
  });

  test('total_created_end missing falls back to start (delta 0)', () => {
    const r = aggregateConnectionPool({
      interval_ms: 1000,
      samples: [{ ts: 1, current: 1, active: 0 }],
      total_created_start: 9,
    });
    assert.deepEqual(r.total_created, { start: 9, end: 9, delta: 0 });
  });

  test('current and active are computed independently', () => {
    const r = aggregateConnectionPool({
      interval_ms: 1000,
      samples: [
        { ts: 1, current: 10, active: 1 },
        { ts: 2, current: 2, active: 9 },
      ],
      total_created_start: 0,
      total_created_end: 0,
    });
    assert.equal(r.current.max, 10);
    assert.equal(r.current.min, 2);
    assert.equal(r.active.max, 9);
    assert.equal(r.active.min, 1);
  });

  test('avg rounds to one decimal place', () => {
    const r = aggregateConnectionPool({
      interval_ms: 1000,
      samples: [
        { ts: 1, current: 1, active: 0 },
        { ts: 2, current: 2, active: 0 },
      ],
      total_created_start: 0,
      total_created_end: 0,
    });
    assert.equal(r.current.avg, 1.5);
  });

  test('shape contract: top-level keys exactly as the dashboard reads', () => {
    const r = aggregateConnectionPool({
      interval_ms: 1000,
      samples: [{ ts: 1, current: 1, active: 0 }],
      total_created_start: 0,
      total_created_end: 0,
    });
    assert.deepEqual(Object.keys(r).sort(), [
      'active', 'current', 'interval_ms', 'metric', 'samples', 'total_created',
    ]);
    assert.deepEqual(Object.keys(r.current).sort(), ['avg', 'end', 'max', 'min']);
    assert.deepEqual(Object.keys(r.total_created).sort(), ['delta', 'end', 'start']);
  });

  test('large connection counts aggregate exactly', () => {
    const samples = [];
    for (let i = 0; i < 100; i++) samples.push({ ts: i, current: 500 + i, active: 400 + i });
    const r = aggregateConnectionPool({
      interval_ms: 1000,
      samples,
      total_created_start: 1000,
      total_created_end: 1099,
    });
    assert.equal(r.samples, 100);
    assert.equal(r.current.min, 500);
    assert.equal(r.current.max, 599);
    assert.equal(r.current.end, 599);
    assert.equal(r.total_created.delta, 99);
  });

  test('string-valued counters coerced via Number()', () => {
    // serverStatus is numeric, but defensive against odd driver shapes.
    const r = aggregateConnectionPool({
      interval_ms: 1000,
      samples: [{ ts: 1, current: '6', active: '3' }],
      total_created_start: '10',
      total_created_end: '15',
    });
    assert.equal(r.current.max, 6);
    assert.equal(r.active.max, 3);
    assert.deepEqual(r.total_created, { start: 10, end: 15, delta: 5 });
  });
});
