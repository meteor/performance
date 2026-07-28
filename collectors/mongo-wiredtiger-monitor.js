// Mongo WiredTiger cache collector. Standalone ESM script spawned by the
// harness like mongo-ops-monitor.js. Connects to the target Mongo, reads
// serverStatus().wiredTiger.cache at startup and again on SIGTERM,
// computes the per-window page-count deltas + cache hit ratio + the
// end-of-run bytes-in-cache gauge, and emits the metrics.mongo_wiredtiger
// JSON to stdout on shutdown.
//
// Usage (the harness wires this):
//   node mongo-wiredtiger-monitor.js <mongoUri>
//
// serverStatus is server-wide (the cache is GLOBAL across all
// collections), so — like mongo-ops — the admin DB handle is used and no
// per-database scoping is needed. The hit ratio therefore reflects the
// whole mongod's cache behavior during the run, which for a Meteor app
// driving mostly its own traffic is the number we want.
//
// On any error during init (Mongo unreachable, auth/RBAC blocks
// serverStatus) OR when the wiredTiger sub-doc is absent (the deployment
// isn't running the WiredTiger storage engine) we log to stderr and exit
// 0 with NO stdout — stopCollectors treats that as "no result" and omits
// the mongo_wiredtiger key entirely (absence convention CC-5). Other
// metrics in the run are unaffected.
//
// CC-6: the mongodb driver comes through runner/_io.js (io.MongoClient)
// so it's swappable/mockable without DI in this script's signature.

import { io } from '../runner/_io.js';
import { aggregateWiredTiger } from '../runner/wiredtiger-aggregator.js';

const uri = process.argv[2];
if (!uri) {
  process.stderr.write('[mongo-wt] missing mongoUri argv\n');
  process.exit(0);
}

const client = new io.MongoClient(uri);
let startCache = null;
let finished = false;

async function readCache() {
  const status = await client.db('admin').command({ serverStatus: 1 });
  // wiredTiger is absent on non-WT storage engines; cache is the sub-doc
  // we need. Either being missing means "no WT metric for this run".
  return status?.wiredTiger?.cache ?? null;
}

async function finishAndExit() {
  if (finished) return;
  finished = true;
  try {
    if (!startCache) {
      process.stderr.write('[mongo-wt] never initialized — no baseline\n');
      return;
    }
    const endCache = await readCache();
    const result = aggregateWiredTiger({ start: startCache, end: endCache });
    // aggregateWiredTiger returns null when WT is missing or there was no
    // cache traffic — emit no stdout so the key is omitted (CC-5).
    if (result) process.stdout.write(JSON.stringify(result));
    else process.stderr.write('[mongo-wt] no cache activity (or WT absent) — omitting metric\n');
  } catch (err) {
    process.stderr.write(`[mongo-wt] error reading endpoint: ${err.message}\n`);
  } finally {
    await client.close().catch(() => {});
    process.exit(0);
  }
}

process.on('SIGTERM', finishAndExit);
process.on('SIGINT', finishAndExit);

try {
  await client.connect();
  startCache = await readCache();
  if (!startCache) {
    process.stderr.write('[mongo-wt] serverStatus().wiredTiger.cache missing — not a WiredTiger engine; omitting metric\n');
    await client.close().catch(() => {});
    process.exit(0);
  }
  process.stderr.write('[mongo-wt] cache baseline captured\n');
} catch (err) {
  process.stderr.write(`[mongo-wt] init failed: ${err.message}\n`);
  process.exit(0);
}
