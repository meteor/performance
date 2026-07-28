import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateDdpMessages } from '../../runner/message-rate-aggregator.js';

describe('aggregateDdpMessages', () => {
  test('null/undefined input → null (absence convention)', () => {
    assert.equal(aggregateDdpMessages(), null);
    assert.equal(aggregateDdpMessages(undefined), null);
    assert.equal(aggregateDdpMessages(null), null);
  });

  test('all-zero / empty counters → null (collector ran, saw nothing)', () => {
    assert.equal(
      aggregateDdpMessages({ startTime: 1000, endTime: 11000, by_in: {}, by_out: {} }),
      null,
    );
  });

  test('single incoming message → counted, out empty', () => {
    const r = aggregateDdpMessages({
      startTime: 0,
      endTime: 10_000,
      by_in: { method: 1 },
      by_out: {},
    });
    assert.equal(r.metric, 'ddp_messages');
    assert.equal(r.total_in, 1);
    assert.equal(r.total_out, 0);
    assert.equal(r.in_per_sec, 0.1);
    assert.equal(r.out_per_sec, 0);
    assert.deepEqual(r.by_type.in, { method: 1 });
    assert.deepEqual(r.by_type.out, {});
  });

  test('single outgoing message → counted, in empty', () => {
    const r = aggregateDdpMessages({
      startTime: 0,
      endTime: 10_000,
      by_in: {},
      by_out: { result: 1 },
    });
    assert.equal(r.total_in, 0);
    assert.equal(r.total_out, 1);
    assert.equal(r.out_per_sec, 0.1);
    assert.deepEqual(r.by_type.out, { result: 1 });
  });

  test('mixed types accumulate into totals + per-type breakdown', () => {
    const r = aggregateDdpMessages({
      startTime: 0,
      endTime: 30_000,
      by_in: { method: 3000, sub: 150, ping: 900, unsub: 150, connect: 150 },
      by_out: { result: 3000, added: 12000, changed: 1200, ready: 150, nosub: 150, pong: 900 },
    });
    assert.equal(r.total_in, 3000 + 150 + 900 + 150 + 150); // 4350
    assert.equal(r.total_out, 3000 + 12000 + 1200 + 150 + 150 + 900); // 17400
    assert.equal(r.duration_s, 30);
    assert.equal(r.in_per_sec, +(4350 / 30).toFixed(2));
    assert.equal(r.out_per_sec, +(17400 / 30).toFixed(2));
    assert.equal(r.by_type.in.method, 3000);
    assert.equal(r.by_type.out.added, 12000);
  });

  test('two independent aggregations do not share state', () => {
    const a = aggregateDdpMessages({ startTime: 0, endTime: 1000, by_in: { ping: 5 }, by_out: {} });
    const b = aggregateDdpMessages({ startTime: 0, endTime: 1000, by_in: { method: 2 }, by_out: {} });
    assert.equal(a.total_in, 5);
    assert.equal(b.total_in, 2);
    assert.equal(a.by_type.in.method, undefined);
    assert.equal(b.by_type.in.ping, undefined);
  });

  test('zero duration (start == end) → rates 0, no divide-by-zero', () => {
    const r = aggregateDdpMessages({
      startTime: 5000,
      endTime: 5000,
      by_in: { method: 100 },
      by_out: { result: 100 },
    });
    assert.equal(r.duration_s, 0);
    assert.equal(r.in_per_sec, 0);
    assert.equal(r.out_per_sec, 0);
    assert.equal(r.total_in, 100);
    assert.equal(r.total_out, 100);
  });

  test('large counts (10000 of each over 10s) → exact totals + rates', () => {
    const r = aggregateDdpMessages({
      startTime: 0,
      endTime: 10_000,
      by_in: { method: 10_000 },
      by_out: { added: 10_000 },
    });
    assert.equal(r.total_in, 10_000);
    assert.equal(r.total_out, 10_000);
    assert.equal(r.in_per_sec, 1000);
    assert.equal(r.out_per_sec, 1000);
  });

  test('shape contract: metric key + nested by_type.in/out', () => {
    const r = aggregateDdpMessages({
      startTime: 0,
      endTime: 1000,
      by_in: { method: 1 },
      by_out: { result: 1 },
    });
    assert.equal(r.metric, 'ddp_messages');
    assert.deepEqual(Object.keys(r).sort(), [
      'by_type', 'duration_s', 'in_per_sec', 'metric', 'out_per_sec', 'total_in', 'total_out',
    ]);
    assert.deepEqual(Object.keys(r.by_type).sort(), ['in', 'out']);
  });

  test('message types with dots survive as object keys', () => {
    const r = aggregateDdpMessages({
      startTime: 0,
      endTime: 1000,
      by_in: { 'method.foo.bar': 3 },
      by_out: { 'sub.ready': 2 },
    });
    assert.equal(r.by_type.in['method.foo.bar'], 3);
    assert.equal(r.by_type.out['sub.ready'], 2);
    assert.equal(r.total_in, 3);
    assert.equal(r.total_out, 2);
  });

  test('only incoming present (no by_out key) → out totals 0, empty breakdown', () => {
    const r = aggregateDdpMessages({ startTime: 0, endTime: 2000, by_in: { ping: 4 } });
    assert.equal(r.total_out, 0);
    assert.deepEqual(r.by_type.out, {});
    assert.equal(r.in_per_sec, 2);
  });

  test('sub-second duration rounds rates to 2 decimals', () => {
    const r = aggregateDdpMessages({
      startTime: 0,
      endTime: 333,
      by_in: { method: 100 },
      by_out: {},
    });
    assert.equal(r.duration_s, 0.33);
    assert.equal(r.in_per_sec, +(100 / 0.333).toFixed(2));
  });
});
