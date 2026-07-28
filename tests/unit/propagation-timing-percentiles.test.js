import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregatePropagationTiming } from '../../runner/collectors.js';

describe('aggregatePropagationTiming', () => {
  test('returns null when input is empty (per absence convention)', () => {
    assert.equal(aggregatePropagationTiming([]), null);
    assert.equal(aggregatePropagationTiming(null), null);
    assert.equal(aggregatePropagationTiming(undefined), null);
  });

  test('produces canonical shape for [10, 20, 30]', () => {
    const result = aggregatePropagationTiming([10, 20, 30]);
    assert.deepEqual(result, {
      metric: 'live_update_propagation',
      observed_updates: 3,
      avg_ms: 20,
      p50: 20,
      p95: 30,
      p99: 30,
      max_ms: 30,
    });
  });

  test('single sample collapses all stats to that value', () => {
    const result = aggregatePropagationTiming([42]);
    assert.equal(result.observed_updates, 1);
    assert.equal(result.avg_ms, 42);
    assert.equal(result.p50, 42);
    assert.equal(result.p95, 42);
    assert.equal(result.p99, 42);
    assert.equal(result.max_ms, 42);
  });

  test('large array (1000 samples) computes percentiles correctly', () => {
    const samples = Array.from({ length: 1000 }, (_, i) => i + 1);
    const result = aggregatePropagationTiming(samples);
    assert.equal(result.observed_updates, 1000);
    assert.equal(result.avg_ms, 500.5);
    assert.equal(result.p50, 500);
    assert.equal(result.p95, 950);
    assert.equal(result.p99, 990);
    assert.equal(result.max_ms, 1000);
  });

  test('output uses BARE percentile suffix (CC-4: p50, p95, p99 — no _ms)', () => {
    const result = aggregatePropagationTiming([10]);
    const fields = Object.keys(result);
    assert.ok(fields.includes('p50'), 'expected bare p50');
    assert.ok(fields.includes('p95'), 'expected bare p95');
    assert.ok(fields.includes('p99'), 'expected bare p99');
    assert.ok(!fields.includes('p50_ms'), 'should NOT have p50_ms (CC-4 violation)');
  });

  test('output uses _ms suffix on non-percentile latency scalars', () => {
    const result = aggregatePropagationTiming([10]);
    const fields = Object.keys(result);
    assert.ok(fields.includes('avg_ms'), 'expected avg_ms suffix');
    assert.ok(fields.includes('max_ms'), 'expected max_ms suffix');
  });

  test('top-level metric field is "live_update_propagation"', () => {
    const result = aggregatePropagationTiming([10]);
    assert.equal(result.metric, 'live_update_propagation');
  });

  test('observed_updates equals input length (one sample per emit)', () => {
    // For propagation, each sub × each doc emit produces one sample;
    // observed_updates is the total emit count across all subscribers.
    const result = aggregatePropagationTiming([1, 1, 1, 1, 1]);
    assert.equal(result.observed_updates, 5);
  });

  test('non-monotonic samples (out of order) still aggregate correctly', () => {
    // Samples are pushed in emit-order which is NOT sorted; the aggregator
    // must sort internally for percentile computation.
    const result = aggregatePropagationTiming([100, 5, 50, 1, 200, 25]);
    assert.equal(result.observed_updates, 6);
    assert.equal(result.max_ms, 200);
    assert.equal(result.avg_ms, (100 + 5 + 50 + 1 + 200 + 25) / 6);
  });

  test('does not include any per-publication or per-doc breakdown', () => {
    // live_update_propagation is intentionally flat — no `publications`,
    // no `methods`, no `docs`. The aggregator output shape locks this.
    const result = aggregatePropagationTiming([10, 20]);
    assert.equal(result.publications, undefined);
    assert.equal(result.methods, undefined);
    assert.equal(result.docs, undefined);
  });

  test('zero-valued samples (instantaneous emit) are kept', () => {
    // A 0 ms propagation is unusual but legitimate (same-tick emit).
    // Don't filter — bias would skew the floor of the distribution.
    const result = aggregatePropagationTiming([0, 5, 10]);
    assert.equal(result.observed_updates, 3);
    assert.equal(result.p50, 5);
  });
});
