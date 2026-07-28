// waitForApp polls io.fetch + io.sleep. Both are mockable points on the plain
// `io` object exported from runner/_io.js — no globalThis pollution, no real
// sleep, no real network.

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { io } from '../../runner/_io.js';
import { waitForApp } from '../../runner/wait-for-app.js';

beforeEach(() => {
  // Stub sleep so the polling loop never actually waits.
  mock.method(io, 'sleep', () => Promise.resolve());
});

afterEach(() => {
  mock.restoreAll();
});

describe('waitForApp — happy path', () => {
  test('resolves on first 200 response', async () => {
    let calls = 0;
    mock.method(io, 'fetch', async () => {
      calls++;
      return { ok: true, status: 200 };
    });
    const result = await waitForApp(3000, { timeoutMs: 5000 });
    assert.equal(result, true);
    assert.equal(calls, 1);
  });

  test('resolves on any 2xx (e.g. 204 No Content)', async () => {
    mock.method(io, 'fetch', async () => ({ ok: true, status: 204 }));
    const result = await waitForApp(3000, { timeoutMs: 5000 });
    assert.equal(result, true);
  });

  test('retries on rejected fetch then resolves once the port comes up', async () => {
    let attempt = 0;
    mock.method(io, 'fetch', async () => {
      attempt++;
      if (attempt < 3) throw new Error('ECONNREFUSED');
      return { ok: true, status: 200 };
    });
    const result = await waitForApp(3000, { timeoutMs: 5000 });
    assert.equal(result, true);
    assert.equal(attempt, 3);
  });

  test('retries on non-2xx (ok: false) then resolves', async () => {
    let attempt = 0;
    mock.method(io, 'fetch', async () => {
      attempt++;
      if (attempt < 2) return { ok: false, status: 503 };
      return { ok: true, status: 200 };
    });
    const result = await waitForApp(3000, { timeoutMs: 5000 });
    assert.equal(result, true);
    assert.equal(attempt, 2);
  });

  test('fetch is called with http://localhost:<port>', async () => {
    const urls = [];
    mock.method(io, 'fetch', async (url) => {
      urls.push(url);
      return { ok: true, status: 200 };
    });
    await waitForApp(4242, { timeoutMs: 5000 });
    assert.equal(urls[0], 'http://localhost:4242');
  });
});

describe('waitForApp — timeout', () => {
  test('throws after timeoutMs with port + seconds + actionable hint in the message', async () => {
    mock.method(io, 'fetch', async () => { throw new Error('ECONNREFUSED'); });
    // timeoutMs: 0 makes the loop bail on the first iteration (Date.now() - start < 0 is false).
    // Tests the error shape without any real wait.
    await assert.rejects(
      () => waitForApp(4242, { timeoutMs: 0 }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /port 4242/);
        assert.match(err.message, /did not start within 0s/);
        assert.match(err.message, /Check Meteor logs above/);
        assert.match(err.message, /raise the timeout/);
        return true;
      }
    );
  });

  test('timeout-seconds shown via Math.round(timeoutMs / 1000)', async () => {
    mock.method(io, 'fetch', async () => { throw new Error('ECONNREFUSED'); });
    await assert.rejects(
      () => waitForApp(3000, { timeoutMs: 0 }),
      /did not start within 0s/
    );
  });
});

describe('waitForApp — does not block on real sleep', () => {
  test('completes quickly even when fetch fails many times before success', async () => {
    let attempts = 0;
    mock.method(io, 'fetch', async () => {
      attempts++;
      if (attempts < 10) throw new Error('not yet');
      return { ok: true, status: 200 };
    });
    const t0 = Date.now();
    await waitForApp(3000, { timeoutMs: 60_000 });
    const elapsed = Date.now() - t0;
    // 10 attempts with a real sleep(1000) between them would be ~9s.
    // Under 1s confirms io.sleep is stubbed and the loop doesn't actually wait.
    assert.ok(elapsed < 1000, `expected <1000ms (mocked sleep), got ${elapsed}ms`);
    assert.equal(attempts, 10);
  });
});
