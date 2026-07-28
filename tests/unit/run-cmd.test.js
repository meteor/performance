// runBenchmark from cli/run.js — validates scenario+app and dispatches to
// the right driver via the drivers plain-object facade.
//
// Mocking strategy:
//   - mock.method(drivers, 'runArtilleryDriver', ...) etc. — drivers/index.js
//     is a plain object, configurable, mock.method works.
//   - process.exit stubbed → exits throw ExitError.
//   - config passes no meteorCheckoutPath → resolveMeteorSource returns
//     system mode without shelling git. No io stubs needed for that.
//   - config.results.{dir,history} points at os.tmpdir() so the real
//     writeResult + appendToHistory write harmlessly.

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { drivers } from '../../drivers/index.js';
import { runBenchmark } from '../../cli/run.js';

class ExitError extends Error {
  constructor(code) { super(`process.exit(${code})`); this.code = code; }
}

let tmpDir;
let logs;
let errors;
let origLog;
let origError;
let origCheckout;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-cmd-'));
  logs = [];
  errors = [];
  origLog = console.log;
  origError = console.error;
  console.log = (msg) => logs.push(String(msg));
  console.error = (msg) => errors.push(String(msg));
  mock.method(process, 'exit', (code) => { throw new ExitError(code); });
  // Don't let env.METEOR_CHECKOUT_PATH from the host leak into resolveMeteorSource
  // (would tip resolution toward checkout mode and force a real git shell-out).
  origCheckout = process.env.METEOR_CHECKOUT_PATH;
  delete process.env.METEOR_CHECKOUT_PATH;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log = origLog;
  console.error = origError;
  if (origCheckout === undefined) delete process.env.METEOR_CHECKOUT_PATH;
  else process.env.METEOR_CHECKOUT_PATH = origCheckout;
  mock.restoreAll();
});

function makeConfig(overrides = {}) {
  return {
    defaultApp: 'tasks-3.x',
    apps: {
      'tasks-3.x': { path: '/fake/apps/tasks-3.x', description: 'test app' },
    },
    scenarios: {
      'reactive-light': { driver: 'artillery-playwright', config: 'artillery/x.yml', description: 'light' },
      'ddp-reactive-light': { driver: 'artillery', config: 'artillery/y.yml', description: 'ddp' },
      'fanout-light': { driver: 'script', script: 'tests/fanout-bench.js', args: '', description: 'fanout' },
      'cold-start': { driver: 'cli', description: 'cold' },
      'bundle-size': { driver: 'cli', description: 'bundle' },
      'hot-reload': { driver: 'cli', description: 'hot' },
    },
    results: {
      dir: path.join(tmpDir, 'results'),
      history: path.join(tmpDir, 'results/history'),
    },
    ...overrides,
  };
}

function fakeDriverResult() {
  return {
    timestamp: new Date().toISOString(),
    tag: 'fake', meteor: { version: 'system', sha: 'unknown' },
    scenario: 'reactive-light', app: 'tasks-3.x',
    wall_clock_ms: 1234, metrics: {},
  };
}

describe('runBenchmark — argv validation', () => {
  test('unknown scenario exits 1 with valid-scenarios list in error', async () => {
    await assert.rejects(
      () => runBenchmark({ values: { scenario: 'no-such', app: 'tasks-3.x' }, config: makeConfig() }),
      (err) => err instanceof ExitError && err.code === 1
    );
    const errText = errors.join('\n');
    assert.match(errText, /Unknown scenario: no-such/);
    assert.match(errText, /Available scenarios: /);
    assert.match(errText, /reactive-light/);
  });

  test('unknown app exits 1 with valid-apps list in error', async () => {
    await assert.rejects(
      () => runBenchmark({ values: { scenario: 'reactive-light', app: 'tasks-99' }, config: makeConfig() }),
      (err) => err instanceof ExitError && err.code === 1
    );
    const errText = errors.join('\n');
    assert.match(errText, /Unknown app: tasks-99/);
    assert.match(errText, /Available apps: tasks-3\.x/);
  });

  test('defaults: no --scenario → "reactive-light" (resolves + dispatches the artillery driver)', async () => {
    // Commit 12 changed the default from reactive-crud (not in any user config
    // by default) to reactive-light (always present, matches README). We assert
    // the default name flows through to the dispatched driver rather than
    // bouncing off an "unknown scenario" check.
    let dispatched = null;
    mock.method(drivers, 'runArtilleryDriver', async (args) => {
      dispatched = args;
      return fakeDriverResult();
    });
    await runBenchmark({ values: {}, config: makeConfig() });
    assert.equal(dispatched.scenarioName, 'reactive-light');
  });
});

describe('runBenchmark — driver dispatch', () => {
  test('scenario.driver === "artillery-playwright" → drivers.runArtilleryDriver', async () => {
    let dispatched = null;
    mock.method(drivers, 'runArtilleryDriver', async (args) => {
      dispatched = 'artillery'; return { ...fakeDriverResult(), _args: args };
    });
    mock.method(drivers, 'runScriptDriver', () => { throw new Error('wrong driver'); });
    mock.method(drivers, 'runColdStartDriver', () => { throw new Error('wrong driver'); });
    mock.method(drivers, 'runBundleSizeDriver', () => { throw new Error('wrong driver'); });

    await runBenchmark({
      values: { scenario: 'reactive-light', app: 'tasks-3.x' },
      config: makeConfig(),
    });
    assert.equal(dispatched, 'artillery');
  });

  test('scenario.driver === "artillery" → drivers.runArtilleryDriver (same dispatch)', async () => {
    let dispatched = null;
    mock.method(drivers, 'runArtilleryDriver', async () => {
      dispatched = 'artillery'; return fakeDriverResult();
    });
    await runBenchmark({
      values: { scenario: 'ddp-reactive-light', app: 'tasks-3.x' },
      config: makeConfig(),
    });
    assert.equal(dispatched, 'artillery');
  });

  test('scenario.driver === "script" → drivers.runScriptDriver', async () => {
    let dispatched = null;
    mock.method(drivers, 'runScriptDriver', async () => {
      dispatched = 'script'; return fakeDriverResult();
    });
    await runBenchmark({
      values: { scenario: 'fanout-light', app: 'tasks-3.x' },
      config: makeConfig(),
    });
    assert.equal(dispatched, 'script');
  });

  test('scenario "cold-start" → drivers.runColdStartDriver', async () => {
    let dispatched = null;
    let receivedRuns = null;
    mock.method(drivers, 'runColdStartDriver', async (args) => {
      dispatched = 'cold-start';
      receivedRuns = args.runs;
      return fakeDriverResult();
    });
    await runBenchmark({
      values: { scenario: 'cold-start', app: 'tasks-3.x', runs: '5' },
      config: makeConfig(),
    });
    assert.equal(dispatched, 'cold-start');
    assert.equal(receivedRuns, 5);
  });

  test('scenario "bundle-size" → drivers.runBundleSizeDriver', async () => {
    let dispatched = null;
    mock.method(drivers, 'runBundleSizeDriver', async () => {
      dispatched = 'bundle-size'; return fakeDriverResult();
    });
    await runBenchmark({
      values: { scenario: 'bundle-size', app: 'tasks-3.x' },
      config: makeConfig(),
    });
    assert.equal(dispatched, 'bundle-size');
  });

  test('scenario with driver "cli" but no matching name (hot-reload) → exits 0 with not-yet-implemented message', async () => {
    await assert.rejects(
      () => runBenchmark({ values: { scenario: 'hot-reload', app: 'tasks-3.x' }, config: makeConfig() }),
      (err) => err instanceof ExitError && err.code === 0
    );
    assert.ok(logs.some((l) => l.includes('not yet implemented')));
  });
});

describe('runBenchmark — driver inputs and result persistence', () => {
  test('passes scenario, scenarioName, app, appName, source, env, tag, config to the driver', async () => {
    let captured;
    mock.method(drivers, 'runArtilleryDriver', async (args) => {
      captured = args; return fakeDriverResult();
    });
    await runBenchmark({
      values: { scenario: 'reactive-light', app: 'tasks-3.x', tag: 'mytag', env: ['A=1', 'B=2'] },
      config: makeConfig(),
    });
    assert.equal(captured.scenarioName, 'reactive-light');
    assert.equal(captured.appName, 'tasks-3.x');
    assert.equal(captured.tag, 'mytag');
    assert.deepEqual(captured.env, { A: '1', B: '2' });
    assert.equal(captured.source.mode, 'system');
    assert.ok(captured.scenario);
    assert.ok(captured.app);
    assert.ok(captured.config);
  });

  test('writes driver result to outputPath and appends to history dir', async () => {
    const result = fakeDriverResult();
    result.tag = 'persist-tag';
    mock.method(drivers, 'runArtilleryDriver', async () => result);

    const outputPath = path.join(tmpDir, 'my-output.json');
    await runBenchmark({
      values: { scenario: 'reactive-light', app: 'tasks-3.x', output: outputPath, tag: 'persist-tag' },
      config: makeConfig(),
    });

    assert.ok(fs.existsSync(outputPath), 'output JSON should be written');
    const written = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(written.tag, 'persist-tag');

    const historyFiles = fs.readdirSync(path.join(tmpDir, 'results', 'history'));
    assert.equal(historyFiles.length, 1);
    assert.match(historyFiles[0], /^reactive-light-persist-tag-\d+\.json$/);
  });

  test('falls back to source.version for tag when --tag is absent (system source → "system")', async () => {
    let captured;
    mock.method(drivers, 'runArtilleryDriver', async (args) => {
      captured = args; return fakeDriverResult();
    });
    await runBenchmark({
      values: { scenario: 'reactive-light', app: 'tasks-3.x' },
      config: makeConfig(),
    });
    assert.equal(captured.tag, 'system');
  });
});
