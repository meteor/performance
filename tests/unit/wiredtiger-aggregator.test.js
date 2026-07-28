import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateWiredTiger } from '../../runner/wiredtiger-aggregator.js';

// serverStatus().wiredTiger.cache snapshot factory. Keys are the exact
// human-readable strings Mongo emits (validated against live Mongo 7.0).
function cache({ requested = 0, readIn = 0, written = 0, bytes = 0 } = {}) {
  return {
    'pages requested from the cache': requested,
    'pages read into cache': readIn,
    'pages written from the cache': written,
    'bytes currently in the cache': bytes,
  };
}

describe('aggregateWiredTiger', () => {
  test('normal delta → hit ratio computed on the window deltas', () => {
    const start = cache({ requested: 1000, readIn: 500, written: 100, bytes: 1000 });
    const end = cache({ requested: 11000, readIn: 600, written: 8600, bytes: 134217728 });
    const r = aggregateWiredTiger({ start, end });
    assert.equal(r.metric, 'mongo_wiredtiger');
    assert.equal(r.pages_requested_in_window, 10000);
    assert.equal(r.pages_read_into_cache, 100);
    assert.equal(r.pages_written_from_cache, 8500);
    // (10000 - 100) / 10000 = 0.99
    assert.equal(r.cache_hit_ratio, 0.99);
    assert.equal(r.bytes_in_cache_end, 134217728);
  });

  test('high hit ratio rounds to 4 decimals', () => {
    const start = cache({ requested: 0, readIn: 0 });
    const end = cache({ requested: 152840, readIn: 120 });
    const r = aggregateWiredTiger({ start, end });
    // (152840 - 120) / 152840 = 0.99921...
    assert.equal(r.cache_hit_ratio, 0.9992);
  });

  test('zero activity (requested delta 0) → null', () => {
    const snap = cache({ requested: 5000, readIn: 50, written: 10, bytes: 999 });
    assert.equal(aggregateWiredTiger({ start: snap, end: snap }), null);
  });

  test('two byte-identical snapshots → null', () => {
    const start = cache({ requested: 100, readIn: 10, written: 5, bytes: 200 });
    const end = cache({ requested: 100, readIn: 10, written: 5, bytes: 200 });
    assert.equal(aggregateWiredTiger({ start, end }), null);
  });

  test('counter reset (end < start) → delta uses end value (server restart)', () => {
    const start = cache({ requested: 50000, readIn: 4000, written: 9000 });
    const end = cache({ requested: 1200, readIn: 30, written: 80, bytes: 4096 });
    const r = aggregateWiredTiger({ start, end });
    assert.equal(r.pages_requested_in_window, 1200);
    assert.equal(r.pages_read_into_cache, 30);
    assert.equal(r.pages_written_from_cache, 80);
    // (1200 - 30) / 1200 = 0.975
    assert.equal(r.cache_hit_ratio, 0.975);
  });

  test('read > requested (defensive) → hit ratio clamped to 0, not negative', () => {
    const start = cache({ requested: 0, readIn: 0 });
    const end = cache({ requested: 100, readIn: 250 });
    const r = aggregateWiredTiger({ start, end });
    assert.equal(r.cache_hit_ratio, 0);
  });

  test('bytes_in_cache_end passes through the END gauge value, not a delta', () => {
    const start = cache({ requested: 0, bytes: 1000 });
    const end = cache({ requested: 10, bytes: 8388608 });
    const r = aggregateWiredTiger({ start, end });
    assert.equal(r.bytes_in_cache_end, 8388608);
  });

  test('missing wiredTiger.cache sub-doc (start) → null (CC-5)', () => {
    assert.equal(aggregateWiredTiger({ start: null, end: cache({ requested: 10 }) }), null);
  });

  test('missing wiredTiger.cache sub-doc (end) → null (CC-5)', () => {
    assert.equal(aggregateWiredTiger({ start: cache({ requested: 10 }), end: undefined }), null);
  });

  test('no args / empty object → null (defensive)', () => {
    assert.equal(aggregateWiredTiger(), null);
    assert.equal(aggregateWiredTiger({}), null);
  });

  test('perfect cache (zero misses) → hit ratio 1', () => {
    const start = cache({ requested: 100, readIn: 5 });
    const end = cache({ requested: 1100, readIn: 5 });
    const r = aggregateWiredTiger({ start, end });
    assert.equal(r.pages_read_into_cache, 0);
    assert.equal(r.cache_hit_ratio, 1);
  });

  test('non-numeric / missing counter fields coerce to 0', () => {
    // A field absent from the sub-doc shouldn't NaN the math.
    const start = { 'pages requested from the cache': 100 };
    const end = { 'pages requested from the cache': 1100, 'pages read into cache': 100 };
    const r = aggregateWiredTiger({ start, end });
    assert.equal(r.pages_requested_in_window, 1000);
    assert.equal(r.pages_read_into_cache, 100);
    assert.equal(r.pages_written_from_cache, 0);
    assert.equal(r.bytes_in_cache_end, 0);
  });
});
