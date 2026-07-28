import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOpRates } from '../../runner/mongo-ops-rates.js';

describe('computeOpRates', () => {
  test('produces canonical shape for simple insert delta', () => {
    const r = computeOpRates({ insert: 100 }, { insert: 600 }, 10_000);
    assert.deepEqual(r, {
      metric: 'mongo_ops',
      duration_s: 10,
      ops_per_sec: { insert: 50 },
      totals: { insert: 500 },
    });
  });

  test('multiple op types each computed independently', () => {
    const start = { insert: 100, query: 1000, update: 0, delete: 50, getmore: 200, command: 10 };
    const end =   { insert: 130, query: 1750, update: 5, delete: 60, getmore: 800, command: 15 };
    const r = computeOpRates(start, end, 5_000);
    assert.equal(r.duration_s, 5);
    assert.equal(r.totals.insert, 30);
    assert.equal(r.totals.query, 750);
    assert.equal(r.totals.update, 5);
    assert.equal(r.totals.delete, 10);
    assert.equal(r.totals.getmore, 600);
    assert.equal(r.totals.command, 5);
    assert.equal(r.ops_per_sec.query, 150);
    assert.equal(r.ops_per_sec.getmore, 120);
  });

  test('zero activity → all rates zero, all totals zero', () => {
    const snap = { insert: 5, query: 100, command: 3 };
    const r = computeOpRates(snap, snap, 10_000);
    assert.equal(r.totals.insert, 0);
    assert.equal(r.totals.query, 0);
    assert.equal(r.totals.command, 0);
    assert.equal(r.ops_per_sec.insert, 0);
    assert.equal(r.ops_per_sec.query, 0);
  });

  test('counter reset (end < start) → delta = end (treat as restart)', () => {
    // If server restarted mid-run, counters reset to 0 and grew from there.
    // The post-restart count IS the actual operation count for that span.
    const r = computeOpRates({ insert: 5000 }, { insert: 200 }, 30_000);
    assert.equal(r.totals.insert, 200);
    assert.equal(r.ops_per_sec.insert, +(200 / 30).toFixed(2));
  });

  test('zero duration → ops_per_sec = 0 (no divide-by-zero)', () => {
    const r = computeOpRates({ insert: 0 }, { insert: 100 }, 0);
    assert.equal(r.totals.insert, 100);
    assert.equal(r.ops_per_sec.insert, 0);
    assert.equal(r.duration_s, 0);
  });

  test('negative duration → coerced to 0 duration (defensive)', () => {
    const r = computeOpRates({ insert: 0 }, { insert: 50 }, -1000);
    assert.equal(r.duration_s, 0);
    assert.equal(r.ops_per_sec.insert, 0);
    assert.equal(r.totals.insert, 50);
  });

  test('end has key that start does not → treated as starting from 0', () => {
    // Mongo may add new opcounter keys across versions; transparent passthrough.
    const r = computeOpRates({ insert: 10 }, { insert: 20, newOp: 7 }, 1_000);
    assert.equal(r.totals.newOp, 7);
    assert.equal(r.ops_per_sec.newOp, 7);
  });

  test('start has key end does not → omitted from output (only end keys iterated)', () => {
    const r = computeOpRates({ insert: 10, oldOp: 5 }, { insert: 20 }, 1_000);
    assert.equal(r.totals.oldOp, undefined);
    assert.equal(r.totals.insert, 10);
  });

  test('null/undefined start treats every end value as raw count', () => {
    const r = computeOpRates(null, { insert: 100, query: 500 }, 10_000);
    assert.equal(r.totals.insert, 100);
    assert.equal(r.totals.query, 500);
    assert.equal(r.ops_per_sec.insert, 10);
    assert.equal(r.ops_per_sec.query, 50);
  });

  test('top-level metric field is "mongo_ops"', () => {
    const r = computeOpRates({ insert: 0 }, { insert: 1 }, 1_000);
    assert.equal(r.metric, 'mongo_ops');
  });

  test('sub-second duration rounds to 2 decimal places', () => {
    const r = computeOpRates({ insert: 0 }, { insert: 333 }, 333);
    assert.equal(r.duration_s, 0.33);
    assert.equal(r.ops_per_sec.insert, +(333 / 0.333).toFixed(2));
  });

  test('non-numeric counter values coerced via Number()', () => {
    // serverStatus shape is always numeric, but defensive in case of NaN/string
    const r = computeOpRates({ insert: '10' }, { insert: '50' }, 1_000);
    assert.equal(r.totals.insert, 40);
    assert.equal(r.ops_per_sec.insert, 40);
  });
});
