import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateDriverFallback } from '../../runner/driver-fallback-aggregator.js';

describe('aggregateDriverFallback', () => {
  test('returns null on null/undefined/missing total', () => {
    assert.equal(aggregateDriverFallback(null), null);
    assert.equal(aggregateDriverFallback(undefined), null);
    assert.equal(aggregateDriverFallback({}), null);
    assert.equal(aggregateDriverFallback({ total_cursors: 0 }), null);
  });

  test('passes through clean shape when total > 0 and no fallbacks', () => {
    const r = aggregateDriverFallback({
      total_cursors: 5,
      no_fallback: 5,
      configured_first: 'changeStreams',
      fallbacks: {},
    });
    assert.deepEqual(r, {
      metric: 'driver_fallbacks',
      total_cursors: 5,
      no_fallback: 5,
      configured_first: 'changeStreams',
      fallbacks: {},
    });
  });

  test('passes through fallback transitions intact', () => {
    const r = aggregateDriverFallback({
      total_cursors: 42,
      no_fallback: 38,
      configured_first: 'oplog',
      fallbacks: { oplog_to_polling: 4 },
    });
    assert.equal(r.metric, 'driver_fallbacks');
    assert.equal(r.total_cursors, 42);
    assert.equal(r.no_fallback, 38);
    assert.equal(r.configured_first, 'oplog');
    assert.deepEqual(r.fallbacks, { oplog_to_polling: 4 });
  });

  test('multiple fallback transitions preserved', () => {
    const r = aggregateDriverFallback({
      total_cursors: 10,
      no_fallback: 4,
      configured_first: 'changeStreams',
      fallbacks: {
        changeStreams_to_oplog: 4,
        changeStreams_to_polling: 2,
      },
    });
    assert.equal(r.fallbacks.changeStreams_to_oplog, 4);
    assert.equal(r.fallbacks.changeStreams_to_polling, 2);
    assert.equal(r.no_fallback, 4);
    assert.equal(r.total_cursors, 10);
  });

  test('missing configured_first → null (preserved)', () => {
    const r = aggregateDriverFallback({
      total_cursors: 3,
      no_fallback: 3,
      fallbacks: {},
    });
    assert.equal(r.configured_first, null);
  });

  test('non-numeric total coerced via Number()', () => {
    const r = aggregateDriverFallback({
      total_cursors: '7',
      no_fallback: '5',
      fallbacks: { changeStreams_to_oplog: 2 },
    });
    assert.equal(r.total_cursors, 7);
    assert.equal(r.no_fallback, 5);
  });

  test('fallbacks object is COPIED (defensive against caller mutation)', () => {
    const input = {
      total_cursors: 2,
      no_fallback: 1,
      fallbacks: { changeStreams_to_oplog: 1 },
    };
    const r = aggregateDriverFallback(input);
    input.fallbacks.changeStreams_to_oplog = 99;
    assert.equal(r.fallbacks.changeStreams_to_oplog, 1);
  });

  test('output keys lock', () => {
    const r = aggregateDriverFallback({
      total_cursors: 1,
      no_fallback: 1,
      configured_first: 'oplog',
      fallbacks: {},
    });
    assert.deepEqual(
      Object.keys(r).sort(),
      ['configured_first', 'fallbacks', 'metric', 'no_fallback', 'total_cursors'],
    );
  });
});
