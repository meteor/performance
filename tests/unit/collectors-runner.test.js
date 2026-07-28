// startCollectors / stopCollectors lifecycle in runner/collectors.js.
//
// findPid (from meteor-process.js) is exercised transitively via io.execFileSync
// — that's the underlying pgrep call. By stubbing io.execFileSync we control
// which pids are "found", which controls which process-monitor children get
// spawned. spawn itself is stubbed via io.spawn.
//
// fs operations (existsSync/readFileSync/unlinkSync) for the GC output file
// use real os.tmpdir() rather than mocks: io.fs is a namespace re-export and
// `mock.method` can't redefine its non-configurable properties. Real file I/O
// in /tmp is fast and honest.

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { io } from '../../runner/_io.js';
import { startCollectors, stopCollectors } from '../../runner/collectors.js';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-collectors-'));
  // Make sleep instant so stopCollectors doesn't wait its 1s drain.
  mock.method(io, 'sleep', () => Promise.resolve());
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  mock.restoreAll();
});

// Build a fake child-process handle. The collector grabs stdout/stderr via
// .on('data', ...) — we use a real EventEmitter so we can emit synthetic
// data lines that the collector code can accumulate.
function makeFakeChild() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  return {
    stdout, stderr,
    kill: () => {},
    _emitStdout: (chunk) => stdout.emit('data', chunk),
  };
}

// Stub findPid by stubbing execFileSync. Map of pattern → pid output.
// pgrep('-f', pattern) → throws (no match) OR returns 'pidN\n'.
function stubPgrep(pidByPattern) {
  mock.method(io, 'execFileSync', (cmd, args) => {
    if (cmd !== 'pgrep') throw new Error(`unexpected execFileSync: ${cmd}`);
    const [, pattern] = args;
    if (pidByPattern[pattern] === undefined) throw new Error('no match');
    return pidByPattern[pattern] + '\n';
  });
}

describe('startCollectors', () => {
  test('spawns process-monitor for both APP and DB pids when found', () => {
    stubPgrep({
      'tasks-3.x/.meteor/local/build/main.js': '11111',
      'tasks-3.x/.meteor/local/db': '22222',
    });
    const spawnCalls = [];
    mock.method(io, 'spawn', (cmd, args) => {
      spawnCalls.push({ cmd, args });
      return makeFakeChild();
    });
    const { procs } = startCollectors({ appName: 'tasks-3.x', gcOutputPath: '/x' });
    assert.equal(procs.length, 2);
    assert.equal(spawnCalls.length, 2);
    assert.equal(spawnCalls[0].cmd, 'node');
    // process-monitor.js path + pid + name
    assert.match(spawnCalls[0].args[0], /process-monitor\.js$/);
    assert.equal(spawnCalls[0].args[1], '11111');
    assert.equal(spawnCalls[0].args[2], 'APP');
    assert.equal(spawnCalls[1].args[1], '22222');
    assert.equal(spawnCalls[1].args[2], 'DB');
  });

  test('skips APP collector cleanly when APP pid is missing (logs, does not crash)', () => {
    stubPgrep({ 'tasks-3.x/.meteor/local/db': '22222' });
    mock.method(io, 'spawn', () => makeFakeChild());
    const { procs } = startCollectors({ appName: 'tasks-3.x', gcOutputPath: null });
    assert.equal(procs.length, 1);
    assert.equal(procs[0].name, 'DB');
  });

  test('skips DB collector cleanly when DB pid is missing', () => {
    stubPgrep({ 'tasks-3.x/.meteor/local/build/main.js': '11111' });
    mock.method(io, 'spawn', () => makeFakeChild());
    const { procs } = startCollectors({ appName: 'tasks-3.x', gcOutputPath: null });
    assert.equal(procs.length, 1);
    assert.equal(procs[0].name, 'APP');
  });

  test('returns empty procs when neither pid is found (no crash)', () => {
    stubPgrep({});
    const spawnSpy = mock.method(io, 'spawn', () => makeFakeChild());
    const { procs } = startCollectors({ appName: 'tasks-3.x', gcOutputPath: null });
    assert.equal(procs.length, 0);
    assert.equal(spawnSpy.mock.callCount(), 0);
  });

  test('passes gcOutputPath through unchanged for stopCollectors to consume later', () => {
    stubPgrep({});
    mock.method(io, 'spawn', () => makeFakeChild());
    const handle = startCollectors({ appName: 'x', gcOutputPath: '/tmp/gc-output.json' });
    assert.equal(handle.gcOutputPath, '/tmp/gc-output.json');
  });
});

describe('stopCollectors', () => {
  test('SIGTERMs each proc, parses stdout JSON, returns dashboard-keyed results', async () => {
    const appChild = makeFakeChild();
    const dbChild = makeFakeChild();
    let killedSignals = [];
    appChild.kill = (sig) => killedSignals.push(['APP', sig]);
    dbChild.kill = (sig) => killedSignals.push(['DB', sig]);

    // Simulate each child writing JSON to stdout. Emit BEFORE stopCollectors so
    // the data accumulates in the closure before SIGTERM + drain.
    appChild._emitStdout(JSON.stringify({
      metric: 'app_resources', name: 'APP', cpu: { avg: 20 }, memory: { avg_mb: 140 },
    }));
    dbChild._emitStdout(JSON.stringify({
      metric: 'db_resources', name: 'DB', cpu: { avg: 4 }, memory: { avg_mb: 90 },
    }));

    const handle = {
      procs: [
        { proc: appChild, name: 'APP', getResult: () => appChild.stdout.listeners('data').length > 0 ? '' : '' },
        { proc: dbChild, name: 'DB', getResult: () => '' },
      ],
      gcOutputPath: null,
    };
    // Override getResult to return the accumulated stdout. The collector wires
    // its own getResult inside spawnProcessMonitor; here we mimic that.
    let appBuf = '';
    let dbBuf = '';
    appChild.stdout.on('data', (d) => { appBuf += d; });
    dbChild.stdout.on('data', (d) => { dbBuf += d; });
    appChild._emitStdout(JSON.stringify({
      metric: 'app_resources', name: 'APP', cpu: { avg: 20 }, memory: { avg_mb: 140 },
    }));
    dbChild._emitStdout(JSON.stringify({
      metric: 'db_resources', name: 'DB', cpu: { avg: 4 }, memory: { avg_mb: 90 },
    }));
    handle.procs[0].getResult = () => appBuf;
    handle.procs[1].getResult = () => dbBuf;

    const results = await stopCollectors(handle);
    assert.deepEqual(killedSignals, [['APP', 'SIGTERM'], ['DB', 'SIGTERM']]);
    const keys = results.map((r) => r.metric).sort();
    assert.deepEqual(keys, ['app_resources', 'db_resources']);
  });

  test('drops malformed JSON from one collector but survives, returns others', async () => {
    const appChild = makeFakeChild();
    const dbChild = makeFakeChild();
    let appBuf = '';
    let dbBuf = '';
    appChild.stdout.on('data', (d) => { appBuf += d; });
    dbChild.stdout.on('data', (d) => { dbBuf += d; });
    appChild._emitStdout('{this is not json{{{');
    dbChild._emitStdout(JSON.stringify({ metric: 'db_resources', name: 'DB' }));

    const handle = {
      procs: [
        { proc: appChild, name: 'APP', getResult: () => appBuf },
        { proc: dbChild, name: 'DB', getResult: () => dbBuf },
      ],
      gcOutputPath: null,
    };
    const results = await stopCollectors(handle);
    assert.equal(results.length, 1);
    assert.equal(results[0].metric, 'db_resources');
  });

  test('skips collectors whose stdout buffer is empty (no JSON to parse)', async () => {
    const appChild = makeFakeChild();
    const handle = {
      procs: [{ proc: appChild, name: 'APP', getResult: () => '' }],
      gcOutputPath: null,
    };
    const results = await stopCollectors(handle);
    assert.equal(results.length, 0);
  });

  test('reads + parses + pushes GC metrics file when present, then deletes it', async () => {
    const gcPath = path.join(tmpDir, 'gc-output.json');
    const gcData = {
      metric: 'gc', unit: 'ms',
      total_pause_ms: 200, count: 130, max_pause_ms: 40, avg_pause_ms: 1.54,
      minor: { count: 95, total_ms: 130 },
      major: { count: 18, total_ms: 80 },
    };
    fs.writeFileSync(gcPath, JSON.stringify(gcData));

    const results = await stopCollectors({ procs: [], gcOutputPath: gcPath });
    assert.equal(results.length, 1);
    assert.deepEqual(results[0], gcData);
    assert.ok(!fs.existsSync(gcPath), 'gc output file should be unlinked after read');
  });

  test('no-crash when gcOutputPath points at a missing file (cold-start, gc collector skipped)', async () => {
    const missing = path.join(tmpDir, 'never-written.json');
    const results = await stopCollectors({ procs: [], gcOutputPath: missing });
    assert.equal(results.length, 0);
  });

  test('no-crash when gcOutputPath is null (cold-start scenarios pass null)', async () => {
    const results = await stopCollectors({ procs: [], gcOutputPath: null });
    assert.deepEqual(results, []);
  });

  test('GC file with malformed JSON is logged and dropped, other procs survive', async () => {
    const gcPath = path.join(tmpDir, 'gc-bad.json');
    fs.writeFileSync(gcPath, '{not-json');
    const appChild = makeFakeChild();
    let appBuf = '';
    appChild.stdout.on('data', (d) => { appBuf += d; });
    appChild._emitStdout(JSON.stringify({ metric: 'app_resources', name: 'APP' }));
    const handle = {
      procs: [{ proc: appChild, name: 'APP', getResult: () => appBuf }],
      gcOutputPath: gcPath,
    };
    const results = await stopCollectors(handle);
    assert.equal(results.length, 1);
    assert.equal(results[0].metric, 'app_resources');
  });

  test('result metrics preserve dashboard-contract keys (app_resources / db_resources / gc)', async () => {
    const gcPath = path.join(tmpDir, 'gc.json');
    fs.writeFileSync(gcPath, JSON.stringify({
      metric: 'gc', total_pause_ms: 100, count: 50, max_pause_ms: 5, avg_pause_ms: 2,
      minor: { count: 40, total_ms: 70 }, major: { count: 10, total_ms: 30 },
    }));
    const appChild = makeFakeChild();
    let appBuf = '';
    appChild.stdout.on('data', (d) => { appBuf += d; });
    appChild._emitStdout(JSON.stringify({ metric: 'app_resources' }));
    const handle = {
      procs: [{ proc: appChild, name: 'APP', getResult: () => appBuf }],
      gcOutputPath: gcPath,
    };
    const results = await stopCollectors(handle);
    const keys = results.map((r) => r.metric).sort();
    assert.deepEqual(keys, ['app_resources', 'gc']);
  });
});
