// Pure cache-hit math for the mongo-wiredtiger collector — extracted from
// the standalone collector so it's unit-testable without a live MongoClient
// or a child process. Mirrors runner/mongo-ops-rates.js.
//
// Input: start + end snapshots of `serverStatus().wiredTiger.cache`. The
// field names are human-readable strings with spaces (validated CORRECT
// against live Mongo 7.0 by the mongo-internals reviewer — do NOT rename):
//   - "pages requested from the cache"  → reads served from cache (counter)
//   - "pages read into cache"           → cache misses, loaded from disk (counter)
//   - "pages written from the cache"    → dirty pages flushed (counter)
//   - "bytes currently in the cache"    → instantaneous cache size (gauge)
//
// Output: the `metrics.mongo_wiredtiger` shape —
//   { metric, cache_hit_ratio, pages_requested_in_window,
//     pages_read_into_cache, pages_written_from_cache, bytes_in_cache_end }
// The three page counts are deltas over the benchmark window (end − start),
// NOT lifetime; bytes_in_cache_end is the end gauge value.
//
// cache_hit_ratio = (requested − read_in) / requested, computed on the
// DELTAS (what THIS run hit), not lifetime counters.
//
// Returns null (absence convention CC-5) when:
//   - either snapshot lacks the wiredTiger.cache sub-doc (e.g. a storage
//     engine that isn't WiredTiger, or RBAC hiding it), OR
//   - there was no cache traffic in the window (requested delta === 0,
//     which also covers two byte-identical snapshots) — a hit ratio over
//     zero requests is meaningless and would divide by zero.
//
// Counter-reset rule (mirrors mongo_ops): if a counter's end < start the
// server restarted mid-run and the counter reset, so the end value IS this
// window's count.

const REQUESTED = 'pages requested from the cache';
const READ_IN = 'pages read into cache';
const WRITTEN = 'pages written from the cache';
const BYTES_IN_CACHE = 'bytes currently in the cache';

function delta(start, end, key) {
  const s = Number(start?.[key] ?? 0);
  const e = Number(end?.[key] ?? 0);
  return e < s ? e : e - s;
}

export function aggregateWiredTiger({ start, end } = {}) {
  if (!start || !end) return null;

  const requested = delta(start, end, REQUESTED);
  const readIn = delta(start, end, READ_IN);
  const written = delta(start, end, WRITTEN);

  if (requested === 0) return null;

  // read_in should never exceed requested (a miss is also a request), but
  // clamp defensively so the ratio stays in [0, 1].
  const hits = Math.max(0, requested - readIn);
  const cacheHitRatio = +(hits / requested).toFixed(4);

  return {
    metric: 'mongo_wiredtiger',
    cache_hit_ratio: cacheHitRatio,
    pages_requested_in_window: requested,
    pages_read_into_cache: readIn,
    pages_written_from_cache: written,
    bytes_in_cache_end: Number(end[BYTES_IN_CACHE] ?? 0),
  };
}
