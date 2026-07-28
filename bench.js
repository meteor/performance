#!/usr/bin/env node

/**
 * Meteor Benchmark Framework — CLI entry point.
 *
 * This file is intentionally thin: parse argv, dispatch to one cli/ handler,
 * exit. All actual work (validating inputs, spawning Meteor, running load,
 * collecting metrics, writing results) lives behind those handlers. Adding a
 * new subcommand means: re-export it from cli/index.js, destructure here,
 * add a case.
 *
 * Usage:
 *   node bench.js list
 *   node bench.js run [--scenario <name>] [--app <name>] [--tag <label>]
 *   node bench.js compare --baseline <file> --target <file> [--format markdown|json]
 *   node bench.js push --result <file.json> [--url <ws-url>] [--key <api-key>]
 *   node bench.js baseline --scenario <name> --run-id <id> [--url <ws-url>]
 *
 * See README.md "Meteor source" for --meteor-version / --meteor-checkout usage.
 */

import { parseArgs } from 'node:util';
import config from './bench.config.js';
import { resolveMeteorSource } from './meteor-source.js';
import * as cli from './cli/index.js';

const { runList, runBenchmark, runCompare, runPush, runBaseline, runClear, runBundleDelta } = cli;

// One shared schema for every subcommand — parseArgs is the single source of
// truth for which flags exist. `multiple: true` for --env lets it be passed
// repeatedly (`--env A=1 --env B=2`). `strict: false` makes unknown flags
// non-fatal so future subcommands can add flags without breaking old shells.
const OPTIONS = {
  scenario: { type: 'string' },
  app: { type: 'string' },
  tag: { type: 'string' },
  output: { type: 'string' },
  runs: { type: 'string' },
  env: { type: 'string', multiple: true },
  'meteor-version': { type: 'string' },
  'meteor-checkout': { type: 'string' },
  baseline: { type: 'string' },
  target: { type: 'string' },
  format: { type: 'string' },
  result: { type: 'string' },
  url: { type: 'string' },
  key: { type: 'string' },
  'run-id': { type: 'string' },
  // runId is a kebab-vs-camel alias that some workflows passed pre-refactor;
  // kept for backwards-compat with already-deployed dispatchers.
  runId: { type: 'string' },
  // bundle-delta flags. Strings here (parseArgs has no number type); the
  // handler coerces. limit = how many recent runs, warn-kb = ⚠️ threshold.
  limit: { type: 'string' },
  'warn-kb': { type: 'string' },
  // `clear` guard — wiping the dashboard is destructive, so require an
  // explicit opt-in flag (boolean, no value).
  confirm: { type: 'boolean' },
};

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: OPTIONS,
  allowPositionals: true,
  strict: false,
});
// The first positional is the subcommand name; everything else is flags.
const command = positionals[0];

function printHelp() {
  console.log(`
Meteor Benchmark Framework

Usage:
  node bench.js list                                    List scenarios and apps
  node bench.js run [--scenario X] [--app Y] [--tag Z]  Run a benchmark
  node bench.js compare --baseline A --target B          Compare two results
  node bench.js push --result <file.json> [--url <ws>]   Push results to dashboard
  node bench.js baseline --scenario X --run-id Y         Set baseline for a scenario
  node bench.js clear --confirm [--url <ws>] [--key K]   Wipe ALL runs from the dashboard
  node bench.js bundle-delta [--limit N] [--format markdown|json] [--warn-kb N]
                                                         Bundle-size trend across saved runs

Dashboard:
  Default URL: ${config.dashboardUrl || 'ws://localhost:4000/websocket'}
  Set BENCH_API_KEY env var or use --key flag for authentication

Meteor source:
  --meteor-version <v> | METEOR_RELEASE=<v>   Pinned published release
  --meteor-checkout <path> | METEOR_CHECKOUT_PATH=<path>   Local Meteor checkout
  (mutually exclusive; see README "Meteor source" for details)
`);
}

// Sync handlers (list, compare) run inline; async handlers (run, push, baseline)
// get a .catch so an unhandled rejection still surfaces as a non-zero exit
// code instead of a stack trace and exit 0. Unknown command → help, no error.
switch (command) {
  case 'list': {
    // list is the only sync command that needs the resolved source up front
    // (to print "Meteor source: …" in its header). Others resolve internally.
    const source = resolveMeteorSource({ flags: values, env: process.env, config });
    runList({ config, source });
    break;
  }
  case 'run':
    runBenchmark({ values, config }).catch((err) => { console.error(err); process.exit(1); });
    break;
  case 'compare':
    runCompare({ values });
    break;
  case 'push':
    runPush({ values, config }).catch((err) => { console.error(err); process.exit(1); });
    break;
  case 'baseline':
    runBaseline({ values, config }).catch((err) => { console.error(err); process.exit(1); });
    break;
  case 'clear':
    runClear({ values, config }).catch((err) => { console.error(err); process.exit(1); });
    break;
  case 'bundle-delta':
    runBundleDelta({ values, config });
    break;
  default:
    printHelp();
}
