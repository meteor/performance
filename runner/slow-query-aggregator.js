// Pure aggregation for the mongo-slow-query collector — extracted from the
// spawned collector script so it's unit-testable without a MongoClient or a
// child process (same split as runner/mongo-ops-rates.js for task 04).
//
// Input: rawEntries = the array of `system.profile` documents captured
// during the benchmark window (Mongo's slow-op log). Each entry has at
// least `op`, `ns`, `millis`, and optionally `command` (with `command.filter`
// — the query predicate) and `planSummary`.
// Opts: { thresholdMs, durationMs } — the slowms threshold the profiler ran
// at and the benchmark wall-clock window, both known only at collector
// runtime (not derivable from the entries), passed through to the output.
//
// Output: the `metrics.mongo_slow_queries` shape per the task 12 spec.
// Returns null when there are no entries (absence convention CC-5: collector
// ran but nothing was slow → caller omits the key entirely; note this means
// a genuinely-clean run reports nothing rather than total_slow:0 — matches
// how the harness omits collectors that produce no data).
//
// by_op is derived from the op types actually present (transparent
// passthrough, like computeOpRates does with opcounter keys) — not a fixed
// key set, so future Mongo op types flow through without a code change.
//
// PII SAFETY (spec risk note): slowest_sample.filter_keys carries only the
// KEY NAMES of command.filter, never the values — the profile doc contains
// the full query predicate, which on prod-like data could be sensitive.

function filterKeysOf(entry) {
  const filter = entry?.command?.filter;
  if (!filter || typeof filter !== 'object') return [];
  return Object.keys(filter);
}

export function aggregateSlowQueries(rawEntries, { thresholdMs = 100, durationMs = 0 } = {}) {
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) return null;

  const byOp = {};
  let slowest = null;
  for (const entry of rawEntries) {
    const op = entry?.op ?? 'unknown';
    byOp[op] = (byOp[op] || 0) + 1;
    const millis = Number(entry?.millis ?? 0);
    // Strictly greater so the FIRST entry at the max time wins (deterministic
    // tie-break per spec) — a later entry must beat it, not just equal it.
    if (slowest === null || millis > Number(slowest.millis ?? 0)) {
      slowest = entry;
    }
  }

  const slowestMs = Number(slowest?.millis ?? 0);
  return {
    metric: 'mongo_slow_queries',
    threshold_ms: thresholdMs,
    duration_s: +(Math.max(0, durationMs) / 1000).toFixed(2),
    total_slow: rawEntries.length,
    by_op: byOp,
    slowest_ms: slowestMs,
    slowest_sample: slowest
      ? {
          ns: slowest.ns ?? null,
          op: slowest.op ?? null,
          filter_keys: filterKeysOf(slowest),
          millis: slowestMs,
          planSummary: slowest.planSummary ?? null,
        }
      : null,
  };
}
