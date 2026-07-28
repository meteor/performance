import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { percentile, summarize } from '../../lib/percentiles.js';

describe('percentile (nearest-rank)', () => {
  test('returns null for empty input', () => {
    assert.equal(percentile([], 50), null);
    assert.equal(percentile(null, 50), null);
    assert.equal(percentile(undefined, 50), null);
  });

  test('returns the single value for one-sample arrays at any p', () => {
    assert.equal(percentile([42], 50), 42);
    assert.equal(percentile([42], 95), 42);
    assert.equal(percentile([42], 99), 42);
  });

  test('p50 of [1,2,3,4,5] is the middle value', () => {
    assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
  });

  test('p95 of [1..100] returns the 95th value', () => {
    const arr = Array.from({ length: 100 }, (_, i) => i + 1);
    assert.equal(percentile(arr, 95), 95);
  });

  test('p99 of [1..100] returns the 99th value', () => {
    const arr = Array.from({ length: 100 }, (_, i) => i + 1);
    assert.equal(percentile(arr, 99), 99);
  });

  test('does not mutate the input array', () => {
    const input = [5, 1, 3, 2, 4];
    const copy = [...input];
    percentile(input, 95);
    assert.deepEqual(input, copy);
  });

  test('handles unsorted input correctly', () => {
    assert.equal(percentile([50, 10, 30, 20, 40], 50), 30);
    assert.equal(percentile([5, 1, 3, 2, 4], 95), 5);
  });
});

describe('summarize', () => {
  test('returns null for empty input (per absence convention)', () => {
    assert.equal(summarize([]), null);
    assert.equal(summarize(null), null);
    assert.equal(summarize(undefined), null);
  });

  test('returns the standard shape for [10, 20, 30]', () => {
    const s = summarize([10, 20, 30]);
    assert.deepEqual(s, {
      count: 3,
      avg: 20,
      p50: 20,
      p95: 30,
      p99: 30,
      max: 30,
    });
  });

  test('single sample collapses all stats to that value', () => {
    const s = summarize([42]);
    assert.deepEqual(s, {
      count: 1,
      avg: 42,
      p50: 42,
      p95: 42,
      p99: 42,
      max: 42,
    });
  });

  test('handles a large array (1000 samples) consistently', () => {
    const arr = Array.from({ length: 1000 }, (_, i) => i + 1);
    const s = summarize(arr);
    assert.equal(s.count, 1000);
    assert.equal(s.avg, 500.5);
    assert.equal(s.p50, 500);
    assert.equal(s.p95, 950);
    assert.equal(s.p99, 990);
    assert.equal(s.max, 1000);
  });

  test('does not mutate the input array', () => {
    const input = [5, 1, 3, 2, 4];
    const copy = [...input];
    summarize(input);
    assert.deepEqual(input, copy);
  });
});
