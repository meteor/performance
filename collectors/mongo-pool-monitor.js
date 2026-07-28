// Mongo connection-pool sampler. Standalone ESM script spawned by the
// harness like mongo-ops-monitor.js. Connects to the target Mongo and
// polls serverStatus().connections on an interval over the whole
// benchmark window (a time-series sampler, NOT a start/end delta —
// connection counts rise and fall as VUs connect/disconnect, so the
// min/max/avg/end shape is what's informative). Emits the
// `metrics.mongo_pool` JSON to stdout on SIGTERM.
//
// Usage (the harness wires this):
//   node mongo-pool-monitor.js <mongoUri> [intervalMs]
//
// Fields sampled (verified live against Mongo 7.0.16 dev_bundle):
//   - connections.current — point-in-time open connections (time-series)
//   - connections.active  — point-in-time connections doing work
//                           (time-series). Saturation shows as
//                           current ≈ active; compare these two, NOT
//                           current vs available (see below).
//   - connections.totalCreated — monotonic counter; we keep the start
//                           baseline + end value and report the delta.
//
// Per REVISIONS.md task 14 (verified live, not just from docs):
//   - connections.totalClosed does NOT exist in Mongo 7.0 — dropped.
//   - connections.available is server-side LISTENER HEADROOM (max
//     incoming slots, ~800k), NOT idle pool connections — dropped from
//     the output; it's not a useful saturation signal.
//
// On any error during init (Mongo unreachable, auth/RBAC blocks
// serverStatus, the connections sub-doc is missing on very old Mongo)
// we log to stderr and exit 0 with NO stdout — stopCollectors treats
// that as "no result" and omits the mongo_pool key entirely (absence
// convention CC-5). Other metrics in the run are unaffected.
//
// serverStatus().connections counts ALL clients on the mongod, not just
// Meteor (an open mongo shell during the run is counted too). Documented
// in the package notes; filtering by appName isn't worth the complexity.

import { io } from '../runner/_io.js';
import { aggregateConnectionPool } from '../runner/connection-pool-aggregator.js';

const uri = process.argv[2];
const intervalMs = Number(process.argv[3]) || 1000;
if (!uri) {
  process.stderr.write('[mongo-pool] missing mongoUri argv\n');
  process.exit(0);
}

const client = new io.MongoClient(uri);
const samples = []; // [{ ts, current, active }]
let totalCreatedStart = null;
let totalCreatedEnd = null;
let timer = null;
let finished = false;

async function readConnections() {
  const status = await client.db('admin').command({ serverStatus: 1 });
  return status.connections;
}

async function sample() {
  try {
    const conn = await readConnections();
    if (!conn) return;
    samples.push({
      ts: Date.now(),
      current: Number(conn.current ?? 0),
      active: Number(conn.active ?? 0),
    });
    // Keep the latest totalCreated so the SIGTERM dump has an end value
    // even though serverStatus is read on every tick.
    if (conn.totalCreated != null) totalCreatedEnd = Number(conn.totalCreated);
  } catch (err) {
    process.stderr.write(`[mongo-pool] sample failed: ${err.message}\n`);
  }
}

function finishAndExit() {
  if (finished) return;
  finished = true;
  if (timer) clearInterval(timer);
  try {
    const result = aggregateConnectionPool({
      interval_ms: intervalMs,
      samples,
      total_created_start: totalCreatedStart,
      total_created_end: totalCreatedEnd,
    });
    if (result) process.stdout.write(JSON.stringify(result));
    else process.stderr.write('[mongo-pool] no samples captured — omitting metric\n');
  } catch (err) {
    process.stderr.write(`[mongo-pool] error building result: ${err.message}\n`);
  } finally {
    client.close().catch(() => {});
    process.exit(0);
  }
}

process.on('SIGTERM', finishAndExit);
process.on('SIGINT', finishAndExit);

try {
  await client.connect();
  const conn = await readConnections();
  if (!conn) {
    process.stderr.write('[mongo-pool] serverStatus().connections missing — omitting metric\n');
    process.exit(0);
  }
  totalCreatedStart = conn.totalCreated != null ? Number(conn.totalCreated) : null;
  totalCreatedEnd = totalCreatedStart;
  // Record the baseline as the first sample so a very short run still
  // produces at least one data point.
  samples.push({
    ts: Date.now(),
    current: Number(conn.current ?? 0),
    active: Number(conn.active ?? 0),
  });
  timer = setInterval(sample, intervalMs);
  timer.unref?.();
  process.stderr.write(`[mongo-pool] baseline captured (current=${conn.current}, active=${conn.active}, totalCreated=${conn.totalCreated}); sampling every ${intervalMs}ms\n`);
} catch (err) {
  process.stderr.write(`[mongo-pool] init failed: ${err.message}\n`);
  process.exit(0);
}
