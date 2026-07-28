import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateCompression } from '../../runner/compression-aggregator.js';

describe('aggregateCompression', () => {
  test('returns null when both dumps are missing', () => {
    assert.equal(aggregateCompression(), null);
    assert.equal(aggregateCompression({}), null);
    assert.equal(aggregateCompression({ frameSize: null, compression: null }), null);
  });

  test('returns null when only frameSize dump is present', () => {
    assert.equal(aggregateCompression({ frameSize: { in_sizes: [10], out_sizes: [20] } }), null);
  });

  test('returns null when only compression dump is present', () => {
    assert.equal(aggregateCompression({ compression: { compressed_bytes_in: 5, compressed_bytes_out: 8 } }), null);
  });

  test('returns null when both dumps present but ALL zero bytes', () => {
    const r = aggregateCompression({
      frameSize: { in_sizes: [], out_sizes: [] },
      compression: { compressed_bytes_in: 0, compressed_bytes_out: 0 },
    });
    assert.equal(r, null);
  });

  test('computes ratio + savings_pct for both directions on typical data', () => {
    const r = aggregateCompression({
      frameSize: { in_sizes: [50, 50], out_sizes: [100, 100, 100] }, // 100 in, 300 out
      compression: { compressed_bytes_in: 50, compressed_bytes_out: 100 },
    });
    assert.equal(r.metric, 'ddp_compression');
    assert.deepEqual(r.in, {
      uncompressed_bytes: 100,
      compressed_bytes: 50,
      ratio: 0.5,
      savings_pct: 50.0,
    });
    assert.deepEqual(r.out, {
      uncompressed_bytes: 300,
      compressed_bytes: 100,
      ratio: 0.3333,
      savings_pct: 66.7,
    });
  });

  test('suspicious-zero: uncompressed > 0 but compressed = 0 → ratio + savings_pct null (not 100%)', () => {
    // Real compression never reduces traffic to zero bytes. When we see
    // uncompressed > 0 but compressed = 0 it means socket-byte capture
    // failed (compression-tracker couldn't resolve the TCP socket).
    // Emit nulls instead of a misleading "100% savings".
    const r = aggregateCompression({
      frameSize: { in_sizes: [100, 200], out_sizes: [500] },
      compression: { compressed_bytes_in: 0, compressed_bytes_out: 0 },
    });
    assert.equal(r.in.uncompressed_bytes, 300);
    assert.equal(r.in.compressed_bytes, 0);
    assert.equal(r.in.ratio, null);
    assert.equal(r.in.savings_pct, null);
    assert.equal(r.out.uncompressed_bytes, 500);
    assert.equal(r.out.compressed_bytes, 0);
    assert.equal(r.out.ratio, null);
    assert.equal(r.out.savings_pct, null);
  });

  test('zero uncompressed in a direction → ratio + savings_pct null', () => {
    const r = aggregateCompression({
      frameSize: { in_sizes: [], out_sizes: [100] },
      compression: { compressed_bytes_in: 0, compressed_bytes_out: 50 },
    });
    assert.equal(r.in.ratio, null);
    assert.equal(r.in.savings_pct, null);
    assert.equal(r.in.uncompressed_bytes, 0);
    assert.equal(r.out.ratio, 0.5);
    assert.equal(r.out.savings_pct, 50.0);
  });

  test('compressed > uncompressed → ratio > 1, savings_pct negative (passed through honestly)', () => {
    // WS framing overhead on tiny messages can inflate compressed beyond
    // uncompressed JSON length; don't clamp, report honestly.
    const r = aggregateCompression({
      frameSize: { in_sizes: [10], out_sizes: [10] },
      compression: { compressed_bytes_in: 20, compressed_bytes_out: 25 },
    });
    assert.equal(r.in.ratio, 2);
    assert.equal(r.in.savings_pct, -100);
    assert.equal(r.out.ratio, 2.5);
    assert.equal(r.out.savings_pct, -150);
  });

  test('ratio rounded to 4 decimals', () => {
    const r = aggregateCompression({
      frameSize: { in_sizes: Array(7).fill(100) }, // 700
      compression: { compressed_bytes_in: 333 },
    });
    assert.equal(r.in.ratio, 0.4757); // 333/700 = 0.47571428...
  });

  test('savings_pct rounded to 1 decimal', () => {
    const r = aggregateCompression({
      frameSize: { out_sizes: [1000] },
      compression: { compressed_bytes_out: 333 },
    });
    assert.equal(r.out.savings_pct, 66.7); // 1 - 0.333 = 0.667 → 66.7
  });

  test('non-numeric inputs coerced to 0 via Number()', () => {
    const r = aggregateCompression({
      frameSize: { in_sizes: ['10', null, undefined, 20], out_sizes: [] },
      compression: { compressed_bytes_in: '15', compressed_bytes_out: 0 },
    });
    assert.equal(r.in.uncompressed_bytes, 30); // '10' + 20 (null/undefined coerce to 0)
    assert.equal(r.in.compressed_bytes, 15);
    assert.equal(r.in.ratio, 0.5);
  });

  test('output shape is exactly { metric, in, out } — no extra fields', () => {
    const r = aggregateCompression({
      frameSize: { in_sizes: [10], out_sizes: [10] },
      compression: { compressed_bytes_in: 5, compressed_bytes_out: 5 },
    });
    assert.deepEqual(Object.keys(r).sort(), ['in', 'metric', 'out']);
  });
});
