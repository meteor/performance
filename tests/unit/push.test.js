// runPush / runBaseline in cli/push.js. DDP and ws live on the io facade
// (runner/_io.js) — same mockable seam as fs/spawn/sleep. Tests stub:
//   - io.SimpleDDP with a fake constructor returning a fake-ddp instance
//   - io.readFileSync for the result file
//   - process.exit so failure paths throw instead of terminating the runner

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { io } from '../../runner/_io.js';
import { runPush, runBaseline } from '../../cli/push.js';

class ExitError extends Error {
  constructor(code) { super(`process.exit(${code})`); this.code = code; }
}

let logs;
let errors;
let origLog;
let origError;
let origBenchKey;

beforeEach(() => {
  logs = [];
  errors = [];
  origLog = console.log;
  origError = console.error;
  console.log = (msg) => logs.push(String(msg));
  console.error = (msg, ...rest) => errors.push([String(msg), ...rest.map(String)].join(' '));
  mock.method(process, 'exit', (code) => { throw new ExitError(code); });
  origBenchKey = process.env.BENCH_API_KEY;
  delete process.env.BENCH_API_KEY;
});

afterEach(() => {
  console.log = origLog;
  console.error = origError;
  if (origBenchKey === undefined) delete process.env.BENCH_API_KEY;
  else process.env.BENCH_API_KEY = origBenchKey;
  mock.restoreAll();
});

function fakeDdpFactory({ callImpl, connectImpl } = {}) {
  const calls = [];
  let connected = false;
  let disconnected = false;
  function FakeDDP(opts) {
    this.opts = opts;
    this.connect = async () => {
      if (connectImpl) await connectImpl();
      connected = true;
    };
    this.call = async (method, ...args) => {
      calls.push({ method, args });
      return callImpl ? callImpl(method, ...args) : 'doc-id-123';
    };
    this.disconnect = () => { disconnected = true; };
    FakeDDP.lastInstance = this;
  }
  FakeDDP.calls = calls;
  FakeDDP.wasConnected = () => connected;
  FakeDDP.wasDisconnected = () => disconnected;
  return FakeDDP;
}

describe('runPush', () => {
  test('connects to URL, calls runs.insert with API key + parsed result, disconnects', async () => {
    const FakeDDP = fakeDdpFactory();
    mock.method(io, 'SimpleDDP', FakeDDP);
    mock.method(io, 'readFileSync', () => JSON.stringify({ tag: 'mytag', metrics: {} }));

    await runPush({
      values: { result: '/path/to/result.json', url: 'ws://dash.example/websocket', key: 'k1' },
      config: {},
    });

    assert.equal(FakeDDP.lastInstance.opts.endpoint, 'ws://dash.example/websocket');
    assert.equal(FakeDDP.lastInstance.opts.SocketConstructor, io.ws);
    assert.equal(FakeDDP.calls.length, 1);
    assert.equal(FakeDDP.calls[0].method, 'runs.insert');
    assert.equal(FakeDDP.calls[0].args[0], 'k1');
    assert.deepEqual(FakeDDP.calls[0].args[1], { tag: 'mytag', metrics: {} });
    assert.ok(FakeDDP.wasConnected());
    assert.ok(FakeDDP.wasDisconnected());
    assert.ok(logs.some((l) => l.includes('Document ID: doc-id-123')));
  });

  test('missing --result flag exits 1 with usage message', async () => {
    await assert.rejects(
      () => runPush({ values: {}, config: {} }),
      (err) => err instanceof ExitError && err.code === 1
    );
    assert.ok(errors.some((e) => e.includes('Usage: node bench.js push --result')));
  });

  test('URL fallback chain: flag > config.dashboardUrl > default', async () => {
    const FakeDDP = fakeDdpFactory();
    mock.method(io, 'SimpleDDP', FakeDDP);
    mock.method(io, 'readFileSync', () => '{}');

    // Config wins when no flag.
    await runPush({
      values: { result: '/x' },
      config: { dashboardUrl: 'ws://from-config/websocket' },
    });
    assert.equal(FakeDDP.lastInstance.opts.endpoint, 'ws://from-config/websocket');

    // Flag wins over config.
    await runPush({
      values: { result: '/x', url: 'ws://from-flag/websocket' },
      config: { dashboardUrl: 'ws://from-config/websocket' },
    });
    assert.equal(FakeDDP.lastInstance.opts.endpoint, 'ws://from-flag/websocket');

    // Default when nothing set.
    await runPush({ values: { result: '/x' }, config: {} });
    assert.equal(FakeDDP.lastInstance.opts.endpoint, 'ws://localhost:4000/websocket');
  });

  test('API-key fallback chain: flag > env.BENCH_API_KEY > config.dashboardApiKey > default', async () => {
    const FakeDDP = fakeDdpFactory();
    mock.method(io, 'SimpleDDP', FakeDDP);
    mock.method(io, 'readFileSync', () => '{}');

    process.env.BENCH_API_KEY = 'k-from-env';
    await runPush({
      values: { result: '/x' },
      config: { dashboardApiKey: 'k-from-config' },
    });
    assert.equal(FakeDDP.calls.at(-1).args[0], 'k-from-env');

    await runPush({
      values: { result: '/x', key: 'k-from-flag' },
      config: { dashboardApiKey: 'k-from-config' },
    });
    assert.equal(FakeDDP.calls.at(-1).args[0], 'k-from-flag');

    delete process.env.BENCH_API_KEY;
    await runPush({
      values: { result: '/x' },
      config: { dashboardApiKey: 'k-from-config' },
    });
    assert.equal(FakeDDP.calls.at(-1).args[0], 'k-from-config');

    await runPush({ values: { result: '/x' }, config: {} });
    assert.equal(FakeDDP.calls.at(-1).args[0], 'dev-bench-key-change-in-prod');
  });

  test('DDP call throwing exits 1 with "Push failed" message', async () => {
    const FakeDDP = fakeDdpFactory({
      callImpl: () => { throw new Error('boom auth fail'); },
    });
    mock.method(io, 'SimpleDDP', FakeDDP);
    mock.method(io, 'readFileSync', () => '{}');

    await assert.rejects(
      () => runPush({ values: { result: '/x', url: 'ws://x' }, config: {} }),
      (err) => err instanceof ExitError && err.code === 1
    );
    assert.ok(errors.some((e) => e.includes('Push failed:') && e.includes('boom auth fail') && e.includes('ws://x')));
    // finally-block runs even on error → disconnect was called.
    assert.ok(FakeDDP.wasDisconnected());
  });
});

describe('runBaseline', () => {
  test('connects, calls baselines.set with key + scenario + runId, disconnects', async () => {
    const FakeDDP = fakeDdpFactory();
    mock.method(io, 'SimpleDDP', FakeDDP);

    await runBaseline({
      values: { scenario: 'reactive-light', 'run-id': 'abc123', url: 'ws://x', key: 'k' },
      config: {},
    });

    assert.equal(FakeDDP.calls[0].method, 'baselines.set');
    assert.deepEqual(FakeDDP.calls[0].args, ['k', 'reactive-light', 'abc123']);
    assert.ok(FakeDDP.wasDisconnected());
    assert.ok(logs.some((l) => l.includes('Baseline set successfully')));
  });

  test('accepts runId (camelCase) as an alias for run-id', async () => {
    const FakeDDP = fakeDdpFactory();
    mock.method(io, 'SimpleDDP', FakeDDP);
    await runBaseline({
      values: { scenario: 's', runId: 'xyz', url: 'ws://x', key: 'k' },
      config: {},
    });
    assert.equal(FakeDDP.calls[0].args[2], 'xyz');
  });

  test('missing --scenario exits 1 with usage', async () => {
    await assert.rejects(
      () => runBaseline({ values: { 'run-id': 'x' }, config: {} }),
      (err) => err instanceof ExitError && err.code === 1
    );
    assert.ok(errors.some((e) => e.includes('Usage: node bench.js baseline --scenario')));
  });

  test('missing --run-id exits 1 with usage', async () => {
    await assert.rejects(
      () => runBaseline({ values: { scenario: 's' }, config: {} }),
      (err) => err instanceof ExitError && err.code === 1
    );
    assert.ok(errors.some((e) => e.includes('--scenario <name> --run-id <id>')));
  });

  test('DDP call throwing exits 1 with "Failed:" message; disconnect still runs', async () => {
    const FakeDDP = fakeDdpFactory({
      callImpl: () => { throw new Error('network down'); },
    });
    mock.method(io, 'SimpleDDP', FakeDDP);

    await assert.rejects(
      () => runBaseline({
        values: { scenario: 's', 'run-id': 'r', url: 'ws://x', key: 'k' },
        config: {},
      }),
      (err) => err instanceof ExitError && err.code === 1
    );
    assert.ok(errors.some((e) => e.includes('Setting baseline failed:') && e.includes('network down') && e.includes('ws://x')));
    assert.ok(FakeDDP.wasDisconnected());
  });
});
