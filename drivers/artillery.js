// Spin up the Meteor app, attach collectors, run `npx artillery` against the
// scenario's YAML config, tear down, build the result object. Caller persists.

import path from 'node:path';
import { io } from '../runner/_io.js';
import {
  ensureAppDeps,
  resetMeteorApp,
  startMeteorApp,
  stopMeteorApp,
} from '../runner/meteor-process.js';
import { waitForApp } from '../runner/wait-for-app.js';
import {
  prepareGcOutput,
  prepareMethodTimingOutput,
  prepareSubTimingOutput,
  preparePropagationTimingOutput,
  prepareObserverPoolOutput,
  prepareDdpMessageOutput,
  prepareFrameSizeOutput,
  prepareCompressionOutput,
  prepareDriverFallbackOutput,
  startCollectors,
  stopCollectors,
  drainPostStopGc,
} from '../runner/collectors.js';
import { buildResult } from '../reporters/json-reporter.js';

const HERE = import.meta.dirname;

export async function runArtilleryDriver({ scenario, scenarioName, app, appName, source, env, tag, config }) {
  ensureAppDeps(app.path);
  resetMeteorApp(source, app.path);

  const { gcMonitorPath, gcOutputPath } = prepareGcOutput(tag);
  const methodTimingPath = prepareMethodTimingOutput(tag);
  const subTimingPath = prepareSubTimingOutput(tag);
  const propagationTimingPath = preparePropagationTimingOutput(tag);
  const observerPoolPath = prepareObserverPoolOutput(tag);
  const ddpMessagePath = prepareDdpMessageOutput(tag);
  const frameSizePath = prepareFrameSizeOutput(tag);
  const compressionPath = prepareCompressionOutput(tag);
  const driverFallbackPath = prepareDriverFallbackOutput(tag);
  console.log(`GC monitor: ${gcMonitorPath}`);
  console.log(`GC output: ${gcOutputPath}`);
  console.log(`Method timing output: ${methodTimingPath}`);
  console.log(`Sub timing output: ${subTimingPath}`);
  console.log(`Propagation timing output: ${propagationTimingPath}`);
  console.log(`Observer pool output: ${observerPoolPath}`);
  console.log(`DDP message output: ${ddpMessagePath}`);
  console.log(`DDP frame size output: ${frameSizePath}`);

  console.log('Starting Meteor app (with GC + bench-monitors)...');
  const { proc: meteorProc, getRuntimeInfo } = startMeteorApp({
    source, appPath: app.path, port: config.appPort, env, gcMonitorPath, gcOutputPath, methodTimingPath, subTimingPath, propagationTimingPath, observerPoolPath, ddpMessagePath, frameSizePath, compressionPath, driverFallbackPath,
  });

  console.log('Waiting for app to start...');
  const startTime = Date.now();
  await waitForApp(config.appPort);
  console.log(`App started in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  // Meteor's local Mongo lives on appPort + 1. BENCH_MONGO_URL overrides
  // for external Mongo (Galaxy, separate node, etc.).
  const mongoUri = process.env.BENCH_MONGO_URL || `mongodb://127.0.0.1:${config.appPort + 1}`;
  const collectors = startCollectors({ appName, mongoUri, gcOutputPath, methodTimingPath, subTimingPath, propagationTimingPath, observerPoolPath, ddpMessagePath, frameSizePath, compressionPath, driverFallbackPath });

  // Override the YAML's hard-coded target so artillery hits whichever
  // port the harness picked via BENCH_PORT (defaults to 3000). Also
  // export REMOTE_URL with the same value so artillery processor scripts
  // (tests/ddp-helpers.js) that open their own DDP connection in
  // beforeScenario hit the same port — without it they default to
  // http://localhost:3000 hard-coded and hang on a closed/wrong port.
  // The 5-minute timeout caps the whole artillery exec: a hung VU
  // (DDP connect that never resolves, etc.) used to lock the harness
  // forever; now we abort and surface partial metrics instead.
  const targetUrl = `http://localhost:${config.appPort}`;
  // Configurable via ARTILLERY_TIMEOUT_MS so sustained ≥5-min load profiles
  // (warmup + 300s + VU drain) aren't truncated by the default 5-min cap.
  const ARTILLERY_TIMEOUT_MS = Number(process.env.ARTILLERY_TIMEOUT_MS) || 5 * 60 * 1000;
  console.log(`\nRunning Artillery: ${scenario.config} (--target ${targetUrl})...`);
  const artilleryStart = Date.now();
  try {
    io.execFileSync('npx', ['artillery', 'run', '--target', targetUrl, path.resolve(HERE, '..', scenario.config)], {
      cwd: path.resolve(HERE, '..'),
      stdio: 'inherit',
      env: { ...process.env, REMOTE_URL: targetUrl },
      timeout: ARTILLERY_TIMEOUT_MS,
    });
  } catch (err) {
    if (err.signal === 'SIGTERM') {
      console.error(`Artillery exceeded ${ARTILLERY_TIMEOUT_MS / 1000}s timeout — aborted. Partial collector data preserved.`);
    } else {
      console.error('Artillery failed:', err.message);
    }
  }
  const wallClockMs = Date.now() - artilleryStart;

  const collectorResults = await stopCollectors(collectors);
  await stopMeteorApp(meteorProc);
  collectorResults.push(...drainPostStopGc(gcOutputPath));

  return buildResult({
    scenario: scenarioName,
    app: appName,
    tag,
    meteor: { version: source.version, sha: source.sha },
    runtime: getRuntimeInfo(),
    collectorResults,
    wallClockMs,
  });
}
