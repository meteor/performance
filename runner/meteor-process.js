// Meteor app lifecycle: install deps, reset, start, find by PID, stop.
//
// All shell-outs go through argv arrays (spawn / execFileSync), never
// template-literal exec strings — keeps user-controlled inputs like
// app paths and release versions out of shell parsing.

import path from 'node:path';
import { io } from './_io.js';
import { createRuntimeInfoExtractor } from './runtime-info-extractor.js';

function meteorArgv(source, subcommandArgs) {
  return source.releaseArg ? [source.releaseArg, ...subcommandArgs] : subcommandArgs;
}

export function ensureAppDeps(appPath) {
  const nodeModules = path.join(appPath, 'node_modules');
  if (io.existsSync(nodeModules)) return;
  console.log('Installing app npm dependencies...');
  io.execFileSync('npm', ['install'], { cwd: appPath, stdio: 'inherit' });
}

export function resetMeteorApp(source, appPath) {
  console.log('Cleaning app state...');
  io.execFileSync(source.meteorCmd, meteorArgv(source, ['reset']), {
    cwd: appPath,
    stdio: 'inherit',
  });
}

// Returns `{ proc, getRuntimeInfo }`. The returned ChildProcess is the same
// shape callers used to get; getRuntimeInfo() returns the latest captured
// `[runtime-info]` values (observer_driver, transport) the app printed.
// `methodTimingPath` / `subTimingPath` / `propagationTimingPath` /
// `observerPoolPath` / `ddpMessagePath` / `frameSizePath` /
// `compressionPath` / `driverFallbackPath` (optional) — when set, the
// spawned Meteor sees them as METHOD_TIMING_OUTPUT / SUB_TIMING_OUTPUT
// / PROPAGATION_TIMING_OUTPUT / OBSERVER_POOL_OUTPUT / DDP_MESSAGE_OUTPUT
// / DDP_FRAME_SIZE_OUTPUT / DDP_COMPRESSION_OUTPUT / DRIVER_FALLBACK_OUTPUT
// and the matching in-app bench-monitors collector dumps to that path
// on SIGTERM. The harness reads them in stopCollectors.
export function startMeteorApp({ source, appPath, port, env = {}, gcMonitorPath, gcOutputPath, methodTimingPath, subTimingPath, propagationTimingPath, observerPoolPath, ddpMessagePath, frameSizePath, compressionPath, driverFallbackPath }) {
  const spawnEnv = { ...process.env, ...env, METEOR_NO_DEPRECATION: 'true' };
  if (gcMonitorPath) {
    /* PATCH-PROF: respect existing SERVER_NODE_OPTIONS (e.g. --prof passed
       via shell). Concat instead of overwrite. */
    const existing = spawnEnv.SERVER_NODE_OPTIONS ? spawnEnv.SERVER_NODE_OPTIONS + ' ' : '';
    spawnEnv.SERVER_NODE_OPTIONS = `${existing}--require ${gcMonitorPath}`;
    if (gcOutputPath) spawnEnv.GC_MONITOR_OUTPUT = gcOutputPath;
  }
  if (methodTimingPath) spawnEnv.METHOD_TIMING_OUTPUT = methodTimingPath;
  if (subTimingPath) spawnEnv.SUB_TIMING_OUTPUT = subTimingPath;
  if (propagationTimingPath) spawnEnv.PROPAGATION_TIMING_OUTPUT = propagationTimingPath;
  if (observerPoolPath) spawnEnv.OBSERVER_POOL_OUTPUT = observerPoolPath;
  if (ddpMessagePath) spawnEnv.DDP_MESSAGE_OUTPUT = ddpMessagePath;
  if (frameSizePath) spawnEnv.DDP_FRAME_SIZE_OUTPUT = frameSizePath;
  if (compressionPath) spawnEnv.DDP_COMPRESSION_OUTPUT = compressionPath;
  if (driverFallbackPath) spawnEnv.DRIVER_FALLBACK_OUTPUT = driverFallbackPath;
  const proc = io.spawn(source.meteorCmd, meteorArgv(source, ['run', '--port', String(port)]), {
    cwd: appPath,
    env: spawnEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const runtime = createRuntimeInfoExtractor();
  const tee = (d) => { runtime.feed(d); process.stderr.write(d); };
  proc.stdout.on('data', tee);
  proc.stderr.on('data', tee);
  return { proc, getRuntimeInfo: runtime.get };
}

// pgrep exits 1 when there's no match. That's an "expected absence" — every
// caller (the collectors layer) treats null as "skip this collector". Catch
// here so callers don't need to.
export function findPid(pattern) {
  try {
    const out = io.execFileSync('pgrep', ['-f', pattern], { encoding: 'utf8' });
    return out.trim().split('\n')[0] || null;
  } catch {
    return null;
  }
}

export async function stopMeteorApp(proc, { graceMs = 3000 } = {}) {
  if (!proc) return;
  proc.kill('SIGTERM');
  await io.sleep(graceMs);
}
