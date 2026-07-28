import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateObserverPool } from '../../runner/observer-pool-aggregator.js';

function sample(muxCount, handleCount, ts = Date.now()) {
  return { ts, muxCount, handleCount };
}

describe('aggregateObserverPool', () => {
  test('null input → null (absence convention CC-5)', () => {
    assert.equal(aggregateObserverPool(), null);
    assert.equal(aggregateObserverPool(null), null);
    assert.equal(aggregateObserverPool({}), null);
  });

  test('empty samples array → null (collector ran 0 ms)', () => {
    assert.equal(aggregateObserverPool({ interval_ms: 1000, samples: [] }), null);
  });

  test('non-array samples → null (defensive)', () => {
    assert.equal(aggregateObserverPool({ interval_ms: 1000, samples: 'nope' }), null);
  });

  test('single sample → min/max/avg/end all equal that value', () => {
    const r = aggregateObserverPool({ interval_ms: 1000, samples: [sample(3, 42)] });
    assert.deepEqual(r.multiplexer_count, { min: 3, max: 3, avg: 3, end: 3 });
    assert.deepEqual(r.handle_count, { min: 42, max: 42, avg: 42, end: 42 });
  });

  test('multiple samples → correct min/max/avg/end for both counts', () => {
    const samples = [
      sample(1, 0),
      sample(5, 100),
      sample(3, 50),
      sample(2, 150),
    ];
    const r = aggregateObserverPool({ interval_ms: 1000, samples });
    // mux: [1,5,3,2] → min 1, max 5, avg 2.75, end 2
    assert.deepEqual(r.multiplexer_count, { min: 1, max: 5, avg: 2.8, end: 2 });
    // handles: [0,100,50,150] → min 0, max 150, avg 75, end 150
    assert.deepEqual(r.handle_count, { min: 0, max: 150, avg: 75, end: 150 });
  });

  test('float averages rounded to one decimal', () => {
    // mux: [1,2] → avg 1.5 ; handles: [1,1,1] doesn't apply, use [1,2,2] → 1.666… → 1.7
    const r = aggregateObserverPool({
      interval_ms: 1000,
      samples: [sample(1, 1), sample(2, 2), sample(1, 2)],
    });
    // mux [1,2,1] avg = 4/3 = 1.333… → 1.3
    assert.equal(r.multiplexer_count.avg, 1.3);
    // handles [1,2,2] avg = 5/3 = 1.666… → 1.7
    assert.equal(r.handle_count.avg, 1.7);
  });

  test('zero-count samples → zeros, not omitted (collector ran, count genuinely 0)', () => {
    const r = aggregateObserverPool({
      interval_ms: 1000,
      samples: [sample(0, 0), sample(0, 0), sample(0, 0)],
    });
    assert.deepEqual(r.multiplexer_count, { min: 0, max: 0, avg: 0, end: 0 });
    assert.deepEqual(r.handle_count, { min: 0, max: 0, avg: 0, end: 0 });
  });

  test('end reflects the LAST sample, even when it is not the min/max', () => {
    // simulates handle count climbing then dropping to 0 after VUs disconnect
    const samples = [sample(2, 10), sample(4, 150), sample(4, 80), sample(1, 0)];
    const r = aggregateObserverPool({ interval_ms: 1000, samples });
    assert.equal(r.handle_count.max, 150);
    assert.equal(r.handle_count.end, 0);
    assert.equal(r.multiplexer_count.end, 1);
  });

  test('large array (1000 samples) computes correctly', () => {
    const samples = [];
    for (let i = 0; i < 1000; i++) samples.push(sample(i % 10, i));
    const r = aggregateObserverPool({ interval_ms: 250, samples });
    assert.equal(r.samples, 1000);
    // mux cycles 0..9 → min 0, max 9
    assert.equal(r.multiplexer_count.min, 0);
    assert.equal(r.multiplexer_count.max, 9);
    // handles 0..999 → min 0, max 999, end 999, avg 499.5
    assert.equal(r.handle_count.min, 0);
    assert.equal(r.handle_count.max, 999);
    assert.equal(r.handle_count.end, 999);
    assert.equal(r.handle_count.avg, 499.5);
  });

  test('shape contract: metric name, samples count, interval_ms passthrough', () => {
    const r = aggregateObserverPool({
      interval_ms: 500,
      samples: [sample(1, 1), sample(2, 2)],
    });
    assert.equal(r.metric, 'observer_pool');
    assert.equal(r.samples, 2);
    assert.equal(r.interval_ms, 500);
    assert.deepEqual(
      Object.keys(r).sort(),
      ['handle_count', 'interval_ms', 'metric', 'multiplexer_count', 'samples'],
    );
    assert.deepEqual(Object.keys(r.multiplexer_count).sort(), ['avg', 'end', 'max', 'min']);
    assert.deepEqual(Object.keys(r.handle_count).sort(), ['avg', 'end', 'max', 'min']);
  });

  test('interval_ms passes through even when undefined', () => {
    const r = aggregateObserverPool({ samples: [sample(1, 1)] });
    assert.equal(r.interval_ms, undefined);
    assert.equal(r.metric, 'observer_pool');
  });
});
