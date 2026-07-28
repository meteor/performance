// `cold-start` driver — measures how long Meteor takes to boot from a clean
// state. Each iteration: reset (wipe DB + cache), start, time-until-2xx, stop.
// We take N samples and report the median (not the mean) so one outlier
// (e.g. macOS deciding to index something mid-boot) doesn't pull the number.
//
// `lastGetRuntimeInfo` records the runtime-info closure from the FINAL
// iteration so the returned `runtime` field reflects what was used. All
// iterations use the same config so any iteration would do, but the last is
// the simplest to capture without an extra variable per loop.

import {
  resetMeteorApp,
  startMeteorApp,
  stopMeteorApp,
} from '../runner/meteor-process.js';
import { waitForApp } from '../runner/wait-for-app.js';
import { buildResult } from '../reporters/json-reporter.js';

const COLD_START_GRACE_MS = 2000;

export async function runColdStartDriver({ scenarioName, app, appName, source, env, tag, config, runs = 3 }) {
  const startupTimes = [];
  let lastGetRuntimeInfo = () => ({});
  console.log(`\nCold-start benchmark: ${runs} runs\n`);

  for (let i = 0; i < runs; i++) {
    console.log(`--- Run ${i + 1}/${runs} ---`);
    resetMeteorApp(source, app.path);
    const { proc: meteorProc, getRuntimeInfo } = startMeteorApp({
      source, appPath: app.path, port: config.appPort, env,
    });
    lastGetRuntimeInfo = getRuntimeInfo;
    const startTime = Date.now();
    await waitForApp(config.appPort);
    const startupMs = Date.now() - startTime;
    startupTimes.push(startupMs);
    console.log(`Startup: ${(startupMs / 1000).toFixed(1)}s`);
    await stopMeteorApp(meteorProc, { graceMs: COLD_START_GRACE_MS });
  }

  startupTimes.sort((a, b) => a - b);
  const median = startupTimes[Math.floor(startupTimes.length / 2)];
  const min = startupTimes[0];
  const max = startupTimes[startupTimes.length - 1];

  console.log(`\nResults: median=${(median / 1000).toFixed(1)}s min=${(min / 1000).toFixed(1)}s max=${(max / 1000).toFixed(1)}s`);

  return buildResult({
    scenario: scenarioName,
    app: appName,
    tag,
    meteor: { version: source.version, sha: source.sha },
    runtime: lastGetRuntimeInfo(),
    collectorResults: [{
      metric: 'cold_start',
      startup_median_ms: median,
      startup_min_ms: min,
      startup_max_ms: max,
      runs: startupTimes,
    }],
    wallClockMs: median,
  });
}
