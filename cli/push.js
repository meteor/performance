// `bench.js push`, `bench.js baseline` and `bench.js clear` — all talk to the
// Galaxy dashboard over DDP (the same protocol Meteor clients use, no REST):
//
//   1. Resolve the dashboard URL + API key from flag > env > config > default
//   2. Open a SimpleDDP connection (uses io.ws under the hood so tests can mock)
//   3. Call ONE method (runs.insert / baselines.set / runs.clear)
//   4. Disconnect in a finally — even on error, so the process can exit cleanly
//
// SimpleDDP+ws is on runner/_io.js so the same mockable boundary works here
// as in runner/. The shared `connect()` helper keeps these dashboard commands
// symmetric — each one is one more handler, not duplicated connection code.

import { io } from '../runner/_io.js';

// Hard-coded fallbacks AT THE BOTTOM of the resolve chain — they exist so a
// fresh clone of the repo can run `bench.js push` against a local dashboard
// without setup. Production callers always override via env (BENCH_API_KEY).
const DEFAULT_URL = 'ws://localhost:4000/websocket';
const DEFAULT_KEY = 'dev-bench-key-change-in-prod';

// Resolution precedence: explicit flag > env var > bench.config.js > default.
// Keep this exact order — workflows pass --url/--key explicitly, dev shells
// usually export BENCH_API_KEY, and the config is the team-shared default.
function resolveUrl(values, config) {
  return values.url || config.dashboardUrl || DEFAULT_URL;
}
function resolveKey(values, config) {
  return values.key || process.env.BENCH_API_KEY || config.dashboardApiKey || DEFAULT_KEY;
}

// reconnectInterval kept low (5s) since these are short-lived CLI sessions —
// a long retry doesn't help if the user is staring at the terminal waiting.
function connect(url) {
  return new io.SimpleDDP({
    endpoint: url,
    SocketConstructor: io.ws,
    reconnectInterval: 5000,
  });
}

export async function runPush({ values, config }) {
  const resultPath = values.result;
  const url = resolveUrl(values, config);
  const apiKey = resolveKey(values, config);

  if (!resultPath) {
    console.error('Usage: node bench.js push --result <file.json> [--url <ws-url>] [--key <api-key>]');
    process.exit(1);
  }

  const result = JSON.parse(io.readFileSync(resultPath, 'utf8'));
  console.log(`Pushing ${resultPath} to ${url}...`);

  const ddp = connect(url);
  try {
    await ddp.connect();
    const docId = await ddp.call('runs.insert', apiKey, result);
    console.log(`Pushed successfully. Document ID: ${docId}`);
  } catch (err) {
    console.error(`Push failed: ${err.message || err}. Check the dashboard URL (${url}) is reachable and BENCH_API_KEY is valid.`);
    process.exit(1);
  } finally {
    ddp.disconnect();
  }
}

export async function runBaseline({ values, config }) {
  const scenario = values.scenario;
  const runId = values['run-id'] || values.runId;
  const url = resolveUrl(values, config);
  const apiKey = resolveKey(values, config);

  if (!scenario || !runId) {
    console.error('Usage: node bench.js baseline --scenario <name> --run-id <id> [--url <ws-url>]');
    process.exit(1);
  }

  console.log(`Setting baseline for "${scenario}" to run ${runId}...`);

  const ddp = connect(url);
  try {
    await ddp.connect();
    await ddp.call('baselines.set', apiKey, scenario, runId);
    console.log('Baseline set successfully.');
  } catch (err) {
    console.error(`Setting baseline failed: ${err.message || err}. Check the dashboard URL (${url}) is reachable and BENCH_API_KEY is valid.`);
    process.exit(1);
  } finally {
    ddp.disconnect();
  }
}

// Wipe every run from the dashboard. Destructive and irreversible, so it
// requires --confirm (or BENCH_CLEAR_CONFIRM=1) to avoid a fat-fingered purge.
export async function runClear({ values, config }) {
  const url = resolveUrl(values, config);
  const apiKey = resolveKey(values, config);

  if (!values.confirm && process.env.BENCH_CLEAR_CONFIRM !== '1') {
    console.error(`Refusing to clear ${url} without confirmation.\nRe-run with --confirm (or BENCH_CLEAR_CONFIRM=1) to wipe ALL runs.`);
    process.exit(1);
  }

  console.log(`Clearing ALL runs on ${url}...`);

  const ddp = connect(url);
  try {
    await ddp.connect();
    const removed = await ddp.call('runs.clear', apiKey);
    console.log(`Cleared successfully. Removed ${removed} run(s).`);
  } catch (err) {
    console.error(`Clear failed: ${err.message || err}. Check the dashboard URL (${url}) is reachable and BENCH_API_KEY is valid.`);
    process.exit(1);
  } finally {
    ddp.disconnect();
  }
}
