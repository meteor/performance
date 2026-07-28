// Mongo slow-query collector. Standalone ESM script spawned by the harness
// like mongo-ops-monitor.js (task 04). Enables Mongo's profiler for the
// benchmark window, then on SIGTERM reads the slow ops captured in
// `system.profile`, aggregates them, RESTORES the original profiler config,
// and emits the `metrics.mongo_slow_queries` JSON to stdout.
//
// Usage (the harness wires this):
//   node mongo-slow-query-monitor.js <mongoUri>
//
// Profiling is PER-DATABASE (unlike serverStatus, which is global) — so we
// target Meteor's app DB. Default `meteor`; override with BENCH_MONGO_DB if
// BENCH_MONGO_URL points at a differently-named database.
//
// On any init error (Mongo unreachable, auth fails, profiler can't enable)
// we log to stderr and exit 0 with NO stdout — stopCollectors treats that as
// "no result" and omits the mongo_slow_queries key (absence convention
// CC-5). Other metrics in the run are unaffected.
//
// THREE REVISIONS.md (task 12) fixes vs the original spec:
//   1. Capture+restore the FULL profiler config via `{ profile: -1 }`, which
//      returns { was, slowms, sampleRate }. `slowms` is a sticky GLOBAL
//      Mongo setting that `{ profile: 0 }` does NOT reset — without restoring
//      it, every benchmark run would leak the harness's slowms=100 into the
//      developer's Mongo. We restore all three fields on shutdown.
//   2. The query predicate is at `command.filter` (read in the aggregator),
//      NOT a top-level field on the profile entry.
//   3. Read `system.profile` with a TIMESTAMP WINDOW (ts >= benchmarkStart)
//      instead of dropping the collection. `system.profile.drop()` is
//      destructive of any pre-existing profile data and noisier; the window
//      read only sees ops from this run.

import { io } from '../runner/_io.js';
import { aggregateSlowQueries } from '../runner/slow-query-aggregator.js';

const uri = process.argv[2];
if (!uri) {
  process.stderr.write('[mongo-slow] missing mongoUri argv\n');
  process.exit(0);
}

const DB_NAME = process.env.BENCH_MONGO_DB || 'meteor';
const THRESHOLD_MS = Number(process.env.MONGO_SLOWMS) || 100;

const client = new io.MongoClient(uri);
let db = null;
let originalProfile = null; // { was, slowms, sampleRate }
let benchmarkStart = null;
let startTime = 0;
let finished = false;

async function restoreProfile() {
  if (!originalProfile) return;
  // Restore all three fields. sampleRate may be undefined on older servers;
  // only include it when present so we don't send `sampleRate: undefined`.
  const cmd = { profile: originalProfile.was ?? 0, slowms: originalProfile.slowms };
  if (originalProfile.sampleRate != null) cmd.sampleRate = originalProfile.sampleRate;
  await db.command(cmd);
}

async function finishAndExit() {
  if (finished) return;
  finished = true;
  try {
    if (!db || !benchmarkStart) {
      process.stderr.write('[mongo-slow] never initialized — no baseline\n');
      return;
    }
    const entries = await db
      .collection('system.profile')
      .find({ ts: { $gte: benchmarkStart } })
      .toArray();
    // Restore BEFORE writing stdout so the developer's Mongo is left clean
    // even if the JSON write or aggregation were to throw.
    await restoreProfile().catch((err) => {
      process.stderr.write(`[mongo-slow] profile restore failed: ${err.message}\n`);
    });
    const result = aggregateSlowQueries(entries, {
      thresholdMs: THRESHOLD_MS,
      durationMs: Date.now() - startTime,
    });
    if (result) process.stdout.write(JSON.stringify(result));
  } catch (err) {
    process.stderr.write(`[mongo-slow] error on finish: ${err.message}\n`);
    // Best-effort restore even if the read path threw.
    await restoreProfile().catch(() => {});
  } finally {
    await client.close().catch(() => {});
    process.exit(0);
  }
}

process.on('SIGTERM', finishAndExit);
process.on('SIGINT', finishAndExit);

try {
  await client.connect();
  db = client.db(DB_NAME);
  // { profile: -1 } reads the current config WITHOUT changing it:
  // returns { was, slowms, sampleRate, ... }.
  originalProfile = await db.command({ profile: -1 });
  benchmarkStart = new Date();
  await db.command({ profile: 1, slowms: THRESHOLD_MS });
  startTime = Date.now();
  process.stderr.write(
    `[mongo-slow] profiling db="${DB_NAME}" at slowms=${THRESHOLD_MS} ` +
    `(was: level=${originalProfile.was} slowms=${originalProfile.slowms})\n`,
  );
} catch (err) {
  process.stderr.write(`[mongo-slow] init failed: ${err.message}\n`);
  // Try to restore in case profiling was enabled before the failure.
  if (db && originalProfile) await restoreProfile().catch(() => {});
  await client.close().catch(() => {});
  process.exit(0);
}
