// Pure rate math for the mongo-ops collector — extracted from the
// spawned collector script so it's unit-testable without spinning up
// MongoClient or a child process.
//
// Input: start + end snapshots of Mongo's `serverStatus().opcounters`
// document (same key set: insert, query, update, delete, getmore,
// command — plus whatever Mongo adds in future versions, all forwarded
// transparently).
// Output: the `metrics.mongo_ops` shape per the task 04 spec.
//
// Two normalization rules:
//   - delta < 0  → server restarted mid-run; treat delta = endVal
//     (counters reset to 0 at restart). Better than clamping to 0 and
//     undercounting.
//   - durationMs <= 0 → ops_per_sec = 0 for all keys (avoid divide-by-zero
//     when the collector is killed before any time passes).

export function computeOpRates(start, end, durationMs) {
  const durationS = Math.max(0, durationMs) / 1000;
  const totals = {};
  const opsPerSec = {};
  for (const op of Object.keys(end || {})) {
    const startVal = Number(start?.[op] ?? 0);
    const endVal = Number(end[op] ?? 0);
    const delta = endVal < startVal ? endVal : endVal - startVal;
    totals[op] = delta;
    opsPerSec[op] = durationS > 0 ? +(delta / durationS).toFixed(2) : 0;
  }
  return {
    metric: 'mongo_ops',
    duration_s: +durationS.toFixed(2),
    ops_per_sec: opsPerSec,
    totals,
  };
}
