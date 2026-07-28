// Produces the result JSON the Galaxy dashboard ingests. Three exports:
//
//   buildResult(...) → object
//     Shapes drivers' collector outputs into the dashboard-contract shape.
//     PURE: meteor info comes in as a parameter, never derived here. The
//     caller (cli/run.js, via meteor-source.js) is the sole owner of git
//     introspection — keeps this file side-effect-free aside from disk
//     writes done by writeResult / appendToHistory.
//
//   writeResult(result, outputPath)
//     Writes pretty-printed JSON to the operator-chosen path, creating
//     parent dirs if needed.
//
//   appendToHistory(result, historyDir)
//     Drops a timestamped copy under the history dir so a re-run that
//     overwrites --output doesn't destroy the trend.
//
// The output shape (do not change without the dashboard team — every field
// path here is read by apps/dashboard/):
//   {
//     timestamp: <ISO 8601>,
//     tag: <human label>,                         ← falls back to meteor.version
//     meteor: { version, sha },                   ← required, throws if missing
//     runtime: { observer_driver?, transport?, observer_driver_actual? },
//     scenario: <name>,
//     app: <name>,
//     wall_clock_ms: <number>,
//     metrics: { [r.metric]: r, ... }             ← collectors self-key
//   }

import fs from 'node:fs';
import path from 'node:path';

function buildResult({ scenario, app, tag, meteor, runtime = {}, collectorResults, wallClockMs }) {
  // The throw is deliberate — there used to be a silent
  // `meteor ?? { version: 'unknown', sha: 'unknown' }` fallback here, but
  // that masked the worst failure mode (omitted meteor info silently lands
  // 'unknown' rows in the dashboard). Throwing forces any new caller to
  // resolve meteor info up front via meteor-source.js.
  if (!meteor || typeof meteor.version !== 'string' || typeof meteor.sha !== 'string') {
    throw new Error(
      'buildResult requires meteor: { version, sha }. ' +
      'Call resolveMeteorSource from meteor-source.js to obtain it.'
    );
  }
  return {
    timestamp: new Date().toISOString(),
    tag: tag || meteor.version,
    meteor,
    runtime,
    scenario,
    app,
    wall_clock_ms: wallClockMs,
    // Each collector tags its output with a `metric` field; we use that as
    // the key here so the dashboard reads `metrics.app_resources.cpu.avg`
    // etc. without any per-collector branching.
    metrics: Object.fromEntries(
      collectorResults.map((r) => [r.metric, r])
    ),
  };
}

function writeResult(result, outputPath) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Trailing newline keeps `git diff` happy when results land in commits.
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
}

function appendToHistory(result, historyDir) {
  if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
  // Date.now() in the filename guarantees uniqueness across rapid re-runs
  // with the same tag (CI nightly that triggers twice in a minute, etc.).
  const filename = `${result.scenario}-${result.tag}-${Date.now()}.json`;
  writeResult(result, path.join(historyDir, filename));
}

export { buildResult, writeResult, appendToHistory };
