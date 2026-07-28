// Pure diff math for the mongo-index-usage collector — extracted from the
// spawned collector script so it's unit-testable without a live MongoClient
// or a child process. Mirrors runner/mongo-ops-rates.js.
//
// Input: start + end snapshots of each collection's `$indexStats` rows.
// Each snapshot is an object keyed by collection name:
//   { <coll>: [ { name, accesses: { ops, since }, key }, ... ], ... }
// `accesses.ops` is a lifetime counter; `since` is when Mongo began
// tracking it (server start / index build). `collections` is the list of
// names to report on (discovered by the collector via listCollections).
//
// Output: the `metrics.mongo_index_usage` shape —
//   { metric, collections: { <coll>: [ { name, ops_in_window, since, key } ] } }
// `ops_in_window` is end.ops − start.ops (what THIS run hit), not lifetime.
//
// Normalization rules (consistent with mongo-ops-rates):
//   - index in end but not start → created/first-tracked mid-run; treat
//     start ops as 0 (the end count IS this window's usage).
//   - end.ops < start.ops → server restarted mid-run and the counter reset;
//     treat ops_in_window = end.ops rather than going negative.
//   - index in start but not end → dropped mid-run; omit (we only iterate
//     end rows, so this falls out for free).
//   - never-used index (ops_in_window === 0) → KEPT, so the operator can
//     see dead indexes that cost write-amplification for nothing.
//
// Returns null when no index rows exist across any collection (absence
// convention CC-5: collector ran but found nothing → omit the key).

function toIso(since) {
  if (since == null) return null;
  if (since instanceof Date) return since.toISOString();
  // $indexStats `since` is a BSON Date; the driver hands it back as a JS
  // Date, but a re-serialized snapshot (or a test) may carry a string —
  // pass valid strings through, coerce anything else date-like.
  const d = new Date(since);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function aggregateIndexUsage({ start, end, collections } = {}) {
  const startSnap = start || {};
  const endSnap = end || {};
  const names = collections || Object.keys(endSnap);

  const out = {};
  let totalRows = 0;

  for (const coll of names) {
    const endRows = endSnap[coll];
    if (!Array.isArray(endRows) || endRows.length === 0) continue;

    const startByName = new Map(
      (Array.isArray(startSnap[coll]) ? startSnap[coll] : []).map((r) => [r.name, r])
    );

    const rows = endRows.map((endRow) => {
      const endOps = Number(endRow?.accesses?.ops ?? 0);
      const startOps = Number(startByName.get(endRow.name)?.accesses?.ops ?? 0);
      const opsInWindow = endOps < startOps ? endOps : endOps - startOps;
      return {
        name: endRow.name,
        ops_in_window: opsInWindow,
        since: toIso(endRow?.accesses?.since),
        key: endRow.key,
      };
    });

    out[coll] = rows;
    totalRows += rows.length;
  }

  if (totalRows === 0) return null;
  return { metric: 'mongo_index_usage', collections: out };
}
