// `bundle-size` driver — produces a production build, measures the three
// numbers that matter, throws the build away. Doesn't spawn a running
// Meteor app, so no collectors, no DDP, no runtime info to capture.
//
// Why we measure CLIENT JS by summing top-level .js files only (instead of
// walking the whole webBrowser tree): Meteor's build emits one or more
// numbered bundle files at the top of programs/web.browser/, plus a
// `packages/` subdir of internal package code that the browser doesn't
// download as part of the initial payload. The top-level .js files ARE
// the user-facing download size, which is the number a developer cares
// about when chasing bloat.
//
// SERVER and TOTAL are honest dirSizeBytes recursive sums — those are
// what gets shipped to the cluster regardless of bundling strategy.

import path from 'node:path';
import { io } from '../runner/_io.js';
import { ensureAppDeps } from '../runner/meteor-process.js';
import { buildResult } from '../reporters/json-reporter.js';

function meteorArgv(source, subcommandArgs) {
  return source.releaseArg ? [source.releaseArg, ...subcommandArgs] : subcommandArgs;
}

// Recursively sum file sizes under a directory. Returns total bytes.
function dirSizeBytes(dirPath) {
  if (!io.existsSync(dirPath)) return 0;
  let total = 0;
  for (const entry of io.readdirSync(dirPath)) {
    const full = path.join(dirPath, entry);
    const stat = io.statSync(full);
    if (stat.isDirectory()) {
      total += dirSizeBytes(full);
    } else {
      total += stat.size;
    }
  }
  return total;
}

const BYTES_PER_KB = 1024;

export async function runBundleSizeDriver({ scenarioName, app, appName, source, env, tag, config }) {
  const buildDir = path.join('/tmp', `meteor-bundle-${Date.now()}`);
  console.log('\nBundle size benchmark\n');

  ensureAppDeps(app.path);

  console.log('Building production bundle...');
  const buildStart = Date.now();
  io.execFileSync(source.meteorCmd, meteorArgv(source, ['build', buildDir, '--directory']), {
    cwd: app.path,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  const buildTimeMs = Date.now() - buildStart;
  console.log(`Build time: ${(buildTimeMs / 1000).toFixed(1)}s`);

  // Client bundle: sum the top-level .js files only (Meteor's web.browser).
  const webBrowserDir = path.join(buildDir, 'bundle', 'programs', 'web.browser');
  let clientSizeKb = 0;
  if (io.existsSync(webBrowserDir)) {
    for (const f of io.readdirSync(webBrowserDir).filter((n) => n.endsWith('.js'))) {
      clientSizeKb += io.statSync(path.join(webBrowserDir, f)).size / BYTES_PER_KB;
    }
  }

  const serverDir = path.join(buildDir, 'bundle', 'programs', 'server');
  const serverSizeKb = Math.round(dirSizeBytes(serverDir) / BYTES_PER_KB);
  const totalSizeKb = Math.round(dirSizeBytes(path.join(buildDir, 'bundle')) / BYTES_PER_KB);

  console.log(`Client JS: ${clientSizeKb.toFixed(0)} KB`);
  console.log(`Server: ${serverSizeKb} KB`);
  console.log(`Total bundle: ${totalSizeKb} KB`);

  io.rmSync(buildDir, { recursive: true, force: true });

  return buildResult({
    scenario: scenarioName,
    app: appName,
    tag,
    meteor: { version: source.version, sha: source.sha },
    collectorResults: [{
      metric: 'bundle_size',
      client_js_kb: Math.round(clientSizeKb),
      server_kb: serverSizeKb,
      total_kb: totalSizeKb,
      build_time_ms: buildTimeMs,
    }],
    wallClockMs: buildTimeMs,
  });
}
