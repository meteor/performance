// `build-profile` driver (tasks 20 + 21) — runs ONE production build with
// METEOR_PROFILE=1, parses the profile tree once, and emits TWO metrics from
// it: build_profile (top-N hot nodes by self_ms) and plugin_compile
// (per-compiler-plugin time). Running both from one build avoids a second
// 60-180s build per benchmark.
//
// Like bundle-size, this is a build-only driver: no running app, no
// collectors, no DDP. It resets first so the build is a clean from-scratch
// compile (incremental rebuilds skip cached isopacks, leaving plugin timings
// near zero — the reset makes the plugin numbers meaningful).
//
// METEOR_PROFILE=1 writes the profile tree to STDOUT (verified on a real
// build — the brief assumed stderr). We capture stdout and parse it. A large
// maxBuffer guards the spec's 1-3 MB worst case. If the build EXITS NONZERO we
// still parse whatever stdout we captured (the profile is printed before the
// final summary) so a late-stage build failure degrades to partial metrics
// rather than nothing — the parser is defensive about truncation.
//
// Each aggregator returns null when its data is absent (empty parse / no
// plugin nodes); we push only non-null results, so the result JSON omits a
// metric that has nothing to report (absence convention CC-5).

import path from 'node:path';
import { io } from '../runner/_io.js';
import { ensureAppDeps, resetMeteorApp } from '../runner/meteor-process.js';
import { buildResult } from '../reporters/json-reporter.js';
import { parseMeteorProfile } from '../runner/meteor-profile-parser.js';
import { aggregateBuildProfile } from '../runner/build-profile-aggregator.js';
import { aggregatePluginCompile } from '../runner/plugin-compile-aggregator.js';

const PROFILE_MAX_BUFFER = 32 * 1024 * 1024; // 32MB — METEOR_PROFILE can be MBs

function meteorArgv(source, subcommandArgs) {
  return source.releaseArg ? [source.releaseArg, ...subcommandArgs] : subcommandArgs;
}

export async function runBuildProfileDriver({ scenarioName, app, appName, source, env, tag, config }) {
  const buildDir = path.join('/tmp', `meteor-build-profile-${Date.now()}`);
  console.log('\nBuild profile benchmark (METEOR_PROFILE=1)\n');

  ensureAppDeps(app.path);
  resetMeteorApp(source, app.path);

  console.log('Building production bundle with profiling...');
  const buildStart = Date.now();
  let stdout = '';
  try {
    stdout = io.execFileSync(source.meteorCmd, meteorArgv(source, ['build', '--directory', buildDir]), {
      cwd: app.path,
      encoding: 'utf8',
      env: { ...process.env, ...env, METEOR_PROFILE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: PROFILE_MAX_BUFFER,
    });
  } catch (err) {
    // Build failed late — keep whatever profile we captured and parse it.
    stdout = err.stdout ? String(err.stdout) : '';
    console.error(`meteor build exited nonzero: ${err.message}. Parsing partial profile (${stdout.length} bytes).`);
  } finally {
    io.rmSync(buildDir, { recursive: true, force: true });
  }
  const wallClockMs = Date.now() - buildStart;
  console.log(`Build time: ${(wallClockMs / 1000).toFixed(1)}s`);

  const parsed = parseMeteorProfile(stdout);
  const buildProfile = aggregateBuildProfile(parsed, { topN: 5 });
  const pluginCompile = aggregatePluginCompile(parsed);

  const collectorResults = [];
  if (buildProfile) {
    collectorResults.push(buildProfile);
    console.log(`Build profile: total ${buildProfile.total_ms}ms, top node "${buildProfile.top_nodes[0]?.name}" ${buildProfile.top_nodes[0]?.self_ms}ms`);
  } else {
    console.error('No build profile nodes parsed — METEOR_PROFILE output missing or format changed.');
  }
  if (pluginCompile) {
    collectorResults.push(pluginCompile);
    console.log(`Plugin compile: ${Object.keys(pluginCompile.plugins).length} plugins, ${pluginCompile.total_plugin_ms}ms total`);
  }

  return buildResult({
    scenario: scenarioName,
    app: appName,
    tag,
    meteor: { version: source.version, sha: source.sha },
    collectorResults,
    wallClockMs,
  });
}
