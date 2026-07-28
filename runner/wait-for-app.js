// Poll an HTTP port until the app responds 2xx, or throw with an actionable
// error if it doesn't come up within timeoutMs.
//
// Replaces the legacy `execSync('curl ...')` + `execSync('sleep 1')` loop
// with native fetch + node:timers/promises, both routed through io so tests
// can stub without polluting globals.

import { io } from './_io.js';

const DEFAULT_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 1000;

export async function waitForApp(port, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await io.fetch(`http://localhost:${port}`);
      if (res.ok) return true;
    } catch {
      // connection refused / DNS / etc. — app not ready yet
    }
    await io.sleep(POLL_INTERVAL_MS);
  }
  const timeoutSec = Math.round(timeoutMs / 1000);
  throw new Error(
    `App on port ${port} did not start within ${timeoutSec}s. ` +
    `Check Meteor logs above; if the app needs longer, raise the timeout.`
  );
}
