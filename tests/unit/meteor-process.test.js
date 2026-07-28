// Lifecycle helpers in runner/meteor-process.js. All shell-outs and fs reads
// go through the `io` object exported from runner/_io.js, so tests stub them
// with mock.method at that single seam.

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { io } from '../../runner/_io.js';
import {
  ensureAppDeps,
  resetMeteorApp,
  startMeteorApp,
  findPid,
  stopMeteorApp,
} from '../../runner/meteor-process.js';

afterEach(() => mock.restoreAll());

describe('ensureAppDeps', () => {
  test('skips npm install when node_modules already exists', () => {
    mock.method(io, 'existsSync', () => true);
    const spy = mock.method(io, 'execFileSync', () => '');
    ensureAppDeps('/some/app');
    assert.equal(spy.mock.callCount(), 0);
  });

  test('runs npm install via execFileSync (argv form, no shell) when node_modules missing', () => {
    mock.method(io, 'existsSync', () => false);
    const calls = [];
    mock.method(io, 'execFileSync', (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return '';
    });
    ensureAppDeps('/path/to/app');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, 'npm');
    assert.deepEqual(calls[0].args, ['install']);
    assert.equal(calls[0].opts.cwd, '/path/to/app');
    assert.equal(calls[0].opts.stdio, 'inherit');
  });

  test('checks for the node_modules path inside appPath', () => {
    const checked = [];
    mock.method(io, 'existsSync', (p) => { checked.push(p); return true; });
    ensureAppDeps('/my/app');
    assert.equal(checked[0], path.join('/my/app', 'node_modules'));
  });
});

describe('resetMeteorApp', () => {
  test('spawns meteorCmd with ["reset"] and appPath as cwd (checkout/system source)', () => {
    const calls = [];
    mock.method(io, 'execFileSync', (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return '';
    });
    resetMeteorApp(
      { mode: 'checkout', meteorCmd: '/path/to/meteor', releaseArg: null },
      '/path/to/app'
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, '/path/to/meteor');
    assert.deepEqual(calls[0].args, ['reset']);
    assert.equal(calls[0].opts.cwd, '/path/to/app');
    assert.equal(calls[0].opts.stdio, 'inherit');
  });

  test('prepends --release=<version> when source is release-mode', () => {
    const calls = [];
    mock.method(io, 'execFileSync', (cmd, args) => { calls.push({ cmd, args }); return ''; });
    resetMeteorApp(
      { mode: 'release', meteorCmd: 'meteor', releaseArg: '--release=3.1.2' },
      '/some/app'
    );
    assert.equal(calls[0].cmd, 'meteor');
    assert.deepEqual(calls[0].args, ['--release=3.1.2', 'reset']);
  });
});

describe('startMeteorApp', () => {
  // Tiny event-emitter that records the `data` handler so tests can simulate
  // the spawned process emitting stderr/stdout chunks.
  function fakeStream() {
    const handlers = [];
    return {
      on: (evt, fn) => { if (evt === 'data') handlers.push(fn); },
      emit: (chunk) => handlers.forEach((fn) => fn(chunk)),
    };
  }
  function fakeProc({ stdout, stderr } = {}) {
    return {
      pid: 12345,
      stdout: stdout || { on: () => {} },
      stderr: stderr || { on: () => {} },
      kill: () => {},
    };
  }

  test('spawns meteorCmd with run+port argv and returns the proc handle', () => {
    let captured;
    mock.method(io, 'spawn', (cmd, args, opts) => {
      captured = { cmd, args, opts };
      return fakeProc();
    });
    const { proc, getRuntimeInfo } = startMeteorApp({
      source: { mode: 'checkout', meteorCmd: '/path/to/meteor', releaseArg: null },
      appPath: '/my/app',
      port: 3000,
    });
    assert.equal(captured.cmd, '/path/to/meteor');
    assert.deepEqual(captured.args, ['run', '--port', '3000']);
    assert.equal(captured.opts.cwd, '/my/app');
    assert.equal(captured.opts.env.METEOR_NO_DEPRECATION, 'true');
    assert.equal(proc.pid, 12345);
    assert.equal(typeof getRuntimeInfo, 'function');
    assert.deepEqual(getRuntimeInfo(), {});
  });

  test('getRuntimeInfo captures [runtime-info] lines emitted on stderr', () => {
    const stderr = fakeStream();
    mock.method(io, 'spawn', () => fakeProc({ stderr }));
    const { getRuntimeInfo } = startMeteorApp({
      source: { mode: 'system', meteorCmd: 'meteor', releaseArg: null },
      appPath: '/app', port: 3000,
    });
    stderr.emit('=> Meteor server running\n');
    stderr.emit('[runtime-info] observer_driver=oplog\n');
    stderr.emit('[runtime-info] transport=uws\n');
    assert.deepEqual(getRuntimeInfo(), { observer_driver: 'oplog', transport: 'uws' });
  });

  test('getRuntimeInfo also captures lines emitted on stdout', () => {
    const stdout = fakeStream();
    mock.method(io, 'spawn', () => fakeProc({ stdout }));
    const { getRuntimeInfo } = startMeteorApp({
      source: { mode: 'system', meteorCmd: 'meteor', releaseArg: null },
      appPath: '/app', port: 3000,
    });
    stdout.emit('[runtime-info] observer_driver=changeStreams\n');
    assert.deepEqual(getRuntimeInfo(), { observer_driver: 'changeStreams' });
  });

  test('prepends --release arg when source is release-mode', () => {
    let captured;
    mock.method(io, 'spawn', (cmd, args, opts) => { captured = { cmd, args }; return fakeProc(); });
    startMeteorApp({
      source: { mode: 'release', meteorCmd: 'meteor', releaseArg: '--release=3.1.2' },
      appPath: '/app', port: 3000,
    });
    assert.deepEqual(captured.args, ['--release=3.1.2', 'run', '--port', '3000']);
  });

  test('sets SERVER_NODE_OPTIONS + GC_MONITOR_OUTPUT when gcMonitorPath + gcOutputPath provided', () => {
    let captured;
    mock.method(io, 'spawn', (cmd, args, opts) => { captured = opts; return fakeProc(); });
    startMeteorApp({
      source: { mode: 'system', meteorCmd: 'meteor', releaseArg: null },
      appPath: '/app',
      port: 3000,
      gcMonitorPath: '/path/to/gc-monitor.cjs',
      gcOutputPath: '/tmp/gc-out.json',
    });
    assert.equal(captured.env.SERVER_NODE_OPTIONS, '--require /path/to/gc-monitor.cjs');
    assert.equal(captured.env.GC_MONITOR_OUTPUT, '/tmp/gc-out.json');
  });

  test('omits GC env vars when gcMonitorPath is not provided (cold-start scenarios)', () => {
    let captured;
    mock.method(io, 'spawn', (cmd, args, opts) => { captured = opts; return fakeProc(); });
    startMeteorApp({
      source: { mode: 'system', meteorCmd: 'meteor', releaseArg: null },
      appPath: '/app',
      port: 3000,
    });
    assert.equal(captured.env.SERVER_NODE_OPTIONS, undefined);
    assert.equal(captured.env.GC_MONITOR_OUTPUT, undefined);
  });

  test('merges caller env into spawn env (custom MONGO_URL etc.)', () => {
    let captured;
    mock.method(io, 'spawn', (cmd, args, opts) => { captured = opts; return fakeProc(); });
    startMeteorApp({
      source: { mode: 'system', meteorCmd: 'meteor', releaseArg: null },
      appPath: '/app',
      port: 3000,
      env: { MONGO_URL_TASKS_3_X: 'mongodb://x:27017/y' },
    });
    assert.equal(captured.env.MONGO_URL_TASKS_3_X, 'mongodb://x:27017/y');
  });
});

describe('findPid', () => {
  test('returns the first pid from pgrep -f <pattern>', () => {
    const calls = [];
    mock.method(io, 'execFileSync', (cmd, args, opts) => {
      calls.push({ cmd, args });
      return 'pid1\npid2\npid3\n';
    });
    const pid = findPid('app/.meteor/local/build/main.js');
    assert.equal(pid, 'pid1');
    assert.equal(calls[0].cmd, 'pgrep');
    assert.deepEqual(calls[0].args, ['-f', 'app/.meteor/local/build/main.js']);
  });

  test('returns null when pgrep exits non-zero (no match)', () => {
    mock.method(io, 'execFileSync', () => {
      const err = new Error('pgrep exit 1');
      throw err;
    });
    assert.equal(findPid('nonexistent-pattern'), null);
  });

  test('returns null on empty stdout (defensive — pgrep can theoretically succeed with no output)', () => {
    mock.method(io, 'execFileSync', () => '\n');
    assert.equal(findPid('whatever'), null);
  });
});

describe('stopMeteorApp', () => {
  test('SIGTERMs the proc and awaits sleep(graceMs=3000) by default', async () => {
    const sleeps = [];
    mock.method(io, 'sleep', (ms) => { sleeps.push(ms); return Promise.resolve(); });
    let killed;
    const proc = { kill: (sig) => { killed = sig; } };
    await stopMeteorApp(proc);
    assert.equal(killed, 'SIGTERM');
    assert.deepEqual(sleeps, [3000]);
  });

  test('honors a custom graceMs', async () => {
    const sleeps = [];
    mock.method(io, 'sleep', (ms) => { sleeps.push(ms); return Promise.resolve(); });
    const proc = { kill: () => {} };
    await stopMeteorApp(proc, { graceMs: 500 });
    assert.deepEqual(sleeps, [500]);
  });

  test('no-op when proc is null/undefined (defensive)', async () => {
    const sleeps = [];
    mock.method(io, 'sleep', (ms) => { sleeps.push(ms); return Promise.resolve(); });
    await stopMeteorApp(null);
    await stopMeteorApp(undefined);
    assert.deepEqual(sleeps, []);
  });
});
