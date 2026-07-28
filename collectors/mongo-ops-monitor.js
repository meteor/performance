// Mongo opcounters collector. Standalone ESM script spawned by the
// harness like process-monitor.js. Connects to the target Mongo,
// reads serverStatus().opcounters at startup and again on SIGTERM,
// computes per-op deltas + per-second rates, and emits the
// `metrics.mongo_ops` JSON to stdout on shutdown.
//
// Usage (the harness wires this):
//   node mongo-ops-monitor.js <mongoUri>
//
// On any error during init (Mongo unreachable, auth fails, etc.) we
// log to stderr and exit 0 with NO stdout — stopCollectors treats that
// as "no result" and omits the mongo_ops key entirely (per absence
// convention CC-5). Other metrics in the run are unaffected.

import { io } from '../runner/_io.js';
import { computeOpRates } from '../runner/mongo-ops-rates.js';

const uri = process.argv[2];
if (!uri) {
  process.stderr.write('[mongo-ops] missing mongoUri argv\n');
  process.exit(0);
}

const client = new io.MongoClient(uri);
let startCounters = null;
let startTime = 0;
let finished = false;

async function readOpcounters() {
  // admin command works on any DB handle; using admin is conventional.
  const status = await client.db('admin').command({ serverStatus: 1 });
  return status.opcounters;
}

async function finishAndExit() {
  if (finished) return;
  finished = true;
  try {
    if (!startCounters) {
      process.stderr.write('[mongo-ops] never initialized — no baseline\n');
      return;
    }
    const endCounters = await readOpcounters();
    const result = computeOpRates(startCounters, endCounters, Date.now() - startTime);
    process.stdout.write(JSON.stringify(result));
  } catch (err) {
    process.stderr.write(`[mongo-ops] error reading endpoint: ${err.message}\n`);
  } finally {
    await client.close().catch(() => {});
    process.exit(0);
  }
}

process.on('SIGTERM', finishAndExit);
process.on('SIGINT', finishAndExit);

try {
  await client.connect();
  startCounters = await readOpcounters();
  startTime = Date.now();
  process.stderr.write(`[mongo-ops] baseline captured (${Object.keys(startCounters).join(',')})\n`);
} catch (err) {
  process.stderr.write(`[mongo-ops] init failed: ${err.message}\n`);
  process.exit(0);
}
