// Active change-stream cursor sampler. Standalone ESM script spawned by
// the harness like mongo-ops-monitor.js / mongo-pool-monitor.js. Polls
// Mongo's currentOp on a fast interval for in-flight change-stream
// getMore cursors and surfaces as `metrics.mongo_changestream` — a
// time-series cursor_count (min/max/avg/end) plus a per-namespace
// breakdown.
//
// Usage (the harness wires this):
//   node mongo-changestream-monitor.js <mongoUri> [intervalMs]
//
// Why it matters: when Meteor's changeStreams reactivity driver is
// active, each distinct observe registers an aggregate({$changeStream})
// cursor against Mongo whose getMores tail the oplog. Counting them
// server-side (and per-namespace) shows whether Meteor's observe dedup
// is working — the Mongo-layer analogue of task 05's observer pool.
//
// currentOp filter — VERIFIED LIVE against the dev_bundle Mongo 7.0.16
// (single-node replica set), by opening real change streams and watching
// currentOp. Two corrections over REVISIONS.md task 24, whose filter
// does NOT work as written:
//   1. Field path is `cursor.originatingCommand.pipeline`, WITH the
//      `cursor.` prefix. The REVISIONS prose says "cursor.originating
//      Command.pipeline" but its code block dropped the prefix —
//      `originatingCommand` sits under the `cursor` sub-doc of each
//      inprog entry, not at top level (confirmed: the top-level path
//      matches 0, the cursor-prefixed path matches every change stream).
//   2. `$elemMatch: { $changeStream: { $exists: true } }` THROWS
//      ("unknown operator: $changeStream" — Mongo parses $changeStream
//      as a query operator inside $elemMatch). The dotted-path form
//      `{ 'cursor.originatingCommand.pipeline.$changeStream': { $exists:
//      true } }` does not throw (here $changeStream is part of a field
//      key, not an operator position) and matches correctly.
// Per REVISIONS: NO `idleCursors` flag (change-stream getMores are
// active awaitData ops — idleCursors:true returns 0). Default sampling
// is 250ms (1 Hz undercounts: getMores complete sub-second, so a slow
// poll misses the in-flight window).
//
// Per-namespace grouping keys off each op's `ns` (e.g. "meteor.tasks") —
// a stable real identifier (CC-7), not a positional name.
//
// On any error during init (Mongo unreachable, currentOp blocked by
// RBAC on Galaxy) we log to stderr and exit 0 with NO stdout —
// stopCollectors omits the mongo_changestream key entirely (absence
// convention CC-5). When the oplog driver is in use (no change streams),
// every sample is simply 0 and the aggregator reports zeros.

import { io } from '../runner/_io.js';
import { aggregateChangestream } from '../runner/changestream-aggregator.js';

const uri = process.argv[2];
const intervalMs = Number(process.argv[3]) || 250;
if (!uri) {
  process.stderr.write('[mongo-changestream] missing mongoUri argv\n');
  process.exit(0);
}

const CURRENTOP_FILTER = {
  currentOp: 1,
  $and: [
    { op: 'getmore' },
    { 'cursor.originatingCommand.pipeline.$changeStream': { $exists: true } },
  ],
};

const client = new io.MongoClient(uri);
const samples = []; // [{ ts, cursorCount, perNs: { ns: count } }]
let timer = null;
let finished = false;

async function readChangestreamOps() {
  const res = await client.db('admin').command(CURRENTOP_FILTER);
  return res.inprog || [];
}

async function sample() {
  try {
    const ops = await readChangestreamOps();
    const perNs = {};
    for (const op of ops) {
      const ns = op.ns || 'unknown';
      perNs[ns] = (perNs[ns] || 0) + 1;
    }
    samples.push({ ts: Date.now(), cursorCount: ops.length, perNs });
  } catch (err) {
    process.stderr.write(`[mongo-changestream] sample failed: ${err.message}\n`);
  }
}

function finishAndExit() {
  if (finished) return;
  finished = true;
  if (timer) clearInterval(timer);
  try {
    const result = aggregateChangestream({ interval_ms: intervalMs, samples });
    if (result) process.stdout.write(JSON.stringify(result));
    else process.stderr.write('[mongo-changestream] no samples captured — omitting metric\n');
  } catch (err) {
    process.stderr.write(`[mongo-changestream] error building result: ${err.message}\n`);
  } finally {
    client.close().catch(() => {});
    process.exit(0);
  }
}

process.on('SIGTERM', finishAndExit);
process.on('SIGINT', finishAndExit);

try {
  await client.connect();
  // One sample at startup so a very short run still has a data point and
  // we surface any currentOp permission error immediately.
  await sample();
  timer = setInterval(sample, intervalMs);
  timer.unref?.();
  process.stderr.write(`[mongo-changestream] sampling currentOp every ${intervalMs}ms (initial cursors: ${samples[0]?.cursorCount ?? 0})\n`);
} catch (err) {
  process.stderr.write(`[mongo-changestream] init failed: ${err.message}\n`);
  process.exit(0);
}
