import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateFrameSize } from '../../runner/frame-size-aggregator.js';

const range = (n) => Array.from({ length: n }, (_, i) => i + 1); // [1..n]

describe('aggregateFrameSize', () => {
  test('null / undefined dump → null', () => {
    assert.equal(aggregateFrameSize(null), null);
    assert.equal(aggregateFrameSize(undefined), null);
  });

  test('both directions empty → null (absence convention CC-5)', () => {
    assert.equal(aggregateFrameSize({ in_sizes: [], out_sizes: [] }), null);
    assert.equal(aggregateFrameSize({}), null);
  });

  test('non-array size fields are treated as empty', () => {
    assert.equal(aggregateFrameSize({ in_sizes: 'nope', out_sizes: null }), null);
  });

  test('single value → count 1, all percentiles equal that value', () => {
    const r = aggregateFrameSize({ in_sizes: [42], out_sizes: [] });
    assert.deepEqual(r.in, {
      count: 1, avg_bytes: 42, p50_bytes: 42, p95_bytes: 42, p99_bytes: 42, max_bytes: 42,
    });
    // out had no samples → zeroed direction (not omitted; the metric as a
    // whole is present because `in` had data).
    assert.deepEqual(r.out, {
      count: 0, avg_bytes: 0, p50_bytes: 0, p95_bytes: 0, p99_bytes: 0, max_bytes: 0,
    });
  });

  test('known input [1..100] → nearest-rank p50=50 p95=95 p99=99 max=100', () => {
    const r = aggregateFrameSize({ in_sizes: [], out_sizes: range(100) });
    assert.equal(r.out.count, 100);
    assert.equal(r.out.p50_bytes, 50);
    assert.equal(r.out.p95_bytes, 95);
    assert.equal(r.out.p99_bytes, 99);
    assert.equal(r.out.max_bytes, 100);
    assert.equal(r.out.avg_bytes, 50.5);
  });

  test('both directions populated independently', () => {
    const r = aggregateFrameSize({ in_sizes: [10, 20, 30], out_sizes: [100, 200] });
    assert.equal(r.in.count, 3);
    assert.equal(r.in.max_bytes, 30);
    assert.equal(r.in.avg_bytes, 20);
    assert.equal(r.out.count, 2);
    assert.equal(r.out.max_bytes, 200);
    assert.equal(r.out.avg_bytes, 150);
  });

  test('avg_bytes rounds to one decimal', () => {
    // [1,2,2] → avg = 5/3 = 1.666… → 1.7
    const r = aggregateFrameSize({ in_sizes: [1, 2, 2], out_sizes: [] });
    assert.equal(r.in.avg_bytes, 1.7);
  });

  test('by_type_bytes passes through both maps', () => {
    const r = aggregateFrameSize({
      in_sizes: [50],
      out_sizes: [80],
      by_type_in_sum: { method: 312000, sub: 4500 },
      by_type_out_sum: { added: 1250000, result: 380000 },
    });
    assert.deepEqual(r.by_type_bytes.in, { method: 312000, sub: 4500 });
    assert.deepEqual(r.by_type_bytes.out, { added: 1250000, result: 380000 });
  });

  test('missing by_type maps default to empty objects', () => {
    const r = aggregateFrameSize({ in_sizes: [10], out_sizes: [20] });
    assert.deepEqual(r.by_type_bytes.in, {});
    assert.deepEqual(r.by_type_bytes.out, {});
  });

  test('by_type_bytes is a copy, not a reference to the dump map', () => {
    const dump = { in_sizes: [10], out_sizes: [], by_type_in_sum: { method: 5 } };
    const r = aggregateFrameSize(dump);
    r.by_type_bytes.in.method = 999;
    assert.equal(dump.by_type_in_sum.method, 5); // original untouched
  });

  test('shape contract: metric name + exact key sets, _bytes suffix on percentiles', () => {
    const r = aggregateFrameSize({
      in_sizes: [1, 2, 3], out_sizes: [4, 5, 6],
      by_type_in_sum: { method: 6 }, by_type_out_sum: { added: 15 },
    });
    assert.equal(r.metric, 'ddp_frame_size');
    assert.deepEqual(Object.keys(r).sort(), ['by_type_bytes', 'in', 'metric', 'out']);
    assert.deepEqual(
      Object.keys(r.in).sort(),
      ['avg_bytes', 'count', 'max_bytes', 'p50_bytes', 'p95_bytes', 'p99_bytes'],
    );
    assert.deepEqual(Object.keys(r.out).sort(), Object.keys(r.in).sort());
    // No bare ms-style percentile keys should leak in.
    assert.equal(r.in.p50, undefined);
    assert.equal(r.in.p95, undefined);
  });

  test('large array (50000 samples) computes without error', () => {
    const big = range(50000);
    const r = aggregateFrameSize({ in_sizes: big, out_sizes: [] });
    assert.equal(r.in.count, 50000);
    assert.equal(r.in.max_bytes, 50000);
    assert.equal(r.in.p50_bytes, 25000);
  });

  test('out-only run: in direction zeroed, out populated', () => {
    const r = aggregateFrameSize({ in_sizes: [], out_sizes: [18, 72, 385, 890, 4520] });
    assert.equal(r.in.count, 0);
    assert.equal(r.out.count, 5);
    assert.equal(r.out.max_bytes, 4520);
  });
});
