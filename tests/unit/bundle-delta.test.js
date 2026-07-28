import { describe, test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { io } from '../../runner/_io.js';
import {
  loadBundleRuns,
  computeTrend,
  formatMarkdown,
  formatJson,
} from '../../cli/bundle-delta.js';

// Minimal bundle-size result fixture. Only the fields bundle-delta reads
// are populated; everything else a real result carries is intentionally
// absent to prove the tool ignores it.
function run({ tag, ts, client = 1000, server = 8000, total = 9000, scenario = 'bundle-size' }) {
  return {
    timestamp: ts,
    tag,
    scenario,
    metrics: { bundle_size: { client_js_kb: client, server_kb: server, total_kb: total } },
  };
}

describe('computeTrend', () => {
  test('empty runs → empty trend (no error)', () => {
    assert.deepEqual(computeTrend([]), []);
  });

  test('single run → one row, delta_kb null', () => {
    const trend = computeTrend([run({ tag: 'r1', ts: '2026-01-01T00:00:00Z', total: 9000 })]);
    assert.equal(trend.length, 1);
    assert.equal(trend[0].delta_kb, null);
    assert.equal(trend[0].total_kb, 9000);
  });

  test('two runs → second row has computed delta', () => {
    const trend = computeTrend([
      run({ tag: 'r1', ts: '2026-01-01T00:00:00Z', total: 9000 }),
      run({ tag: 'r1', ts: '2026-01-02T00:00:00Z', total: 9042 }),
    ]);
    assert.equal(trend.length, 2);
    assert.equal(trend[0].delta_kb, null);
    assert.equal(trend[1].delta_kb, 42);
  });

  test('five runs out of order → sorted by timestamp ascending, all deltas computed', () => {
    const trend = computeTrend([
      run({ tag: 't3', ts: '2026-01-05T00:00:00Z', total: 9100 }),
      run({ tag: 't1', ts: '2026-01-01T00:00:00Z', total: 9000 }),
      run({ tag: 't4', ts: '2026-01-07T00:00:00Z', total: 9100 }),
      run({ tag: 't2', ts: '2026-01-03T00:00:00Z', total: 9010 }),
      run({ tag: 't5', ts: '2026-01-09T00:00:00Z', total: 9250 }),
    ]);
    assert.deepEqual(trend.map((r) => r.tag), ['t1', 't2', 't3', 't4', 't5']);
    assert.deepEqual(trend.map((r) => r.delta_kb), [null, 10, 90, 0, 150]);
  });

  test('delta can be negative (bundle shrank)', () => {
    const trend = computeTrend([
      run({ tag: 'r1', ts: '2026-01-01T00:00:00Z', total: 9000 }),
      run({ tag: 'r1', ts: '2026-01-02T00:00:00Z', total: 8900 }),
    ]);
    assert.equal(trend[1].delta_kb, -100);
  });

  test('limit=2 with 5 runs → keeps the 2 most-recent, delta is within the window', () => {
    const trend = computeTrend([
      run({ tag: 't1', ts: '2026-01-01T00:00:00Z', total: 9000 }),
      run({ tag: 't2', ts: '2026-01-02T00:00:00Z', total: 9010 }),
      run({ tag: 't3', ts: '2026-01-03T00:00:00Z', total: 9020 }),
      run({ tag: 't4', ts: '2026-01-04T00:00:00Z', total: 9030 }),
      run({ tag: 't5', ts: '2026-01-05T00:00:00Z', total: 9100 }),
    ], { limit: 2 });
    assert.deepEqual(trend.map((r) => r.tag), ['t4', 't5']);
    // First row of the window resets to null; second is curr-prev within window.
    assert.equal(trend[0].delta_kb, null);
    assert.equal(trend[1].delta_kb, 70);
  });
});

describe('loadBundleRuns', () => {
  afterEach(() => mock.restoreAll());

  test('missing history dir → empty array (no readdir attempted)', () => {
    mock.method(io, 'existsSync', () => false);
    const readdir = mock.method(io, 'readdirSync', () => { throw new Error('should not read'); });
    assert.deepEqual(loadBundleRuns('/nope', io), []);
    assert.equal(readdir.mock.calls.length, 0);
  });

  test('reads only *.json files and parses them', () => {
    mock.method(io, 'existsSync', () => true);
    mock.method(io, 'readdirSync', () => ['a.json', 'README.md', 'b.json']);
    const files = {
      'a.json': JSON.stringify(run({ tag: 'a', ts: '2026-01-01T00:00:00Z' })),
      'b.json': JSON.stringify(run({ tag: 'b', ts: '2026-01-02T00:00:00Z' })),
    };
    mock.method(io, 'readFileSync', (p) => files[p.split('/').pop()]);
    const runs = loadBundleRuns('/hist', io);
    assert.equal(runs.length, 2);
    assert.deepEqual(runs.map((r) => r.tag).sort(), ['a', 'b']);
  });

  test('excludes files whose scenario is not bundle-size', () => {
    mock.method(io, 'existsSync', () => true);
    mock.method(io, 'readdirSync', () => ['bundle.json', 'other.json']);
    const files = {
      'bundle.json': JSON.stringify(run({ tag: 'b', ts: '2026-01-01T00:00:00Z' })),
      'other.json': JSON.stringify(run({ tag: 'x', ts: '2026-01-02T00:00:00Z', scenario: 'cold-start' })),
    };
    mock.method(io, 'readFileSync', (p) => files[p.split('/').pop()]);
    const runs = loadBundleRuns('/hist', io);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].tag, 'b');
  });

  test('excludes files missing metrics.bundle_size.total_kb (forward-compat guard)', () => {
    mock.method(io, 'existsSync', () => true);
    mock.method(io, 'readdirSync', () => ['good.json', 'noTotal.json']);
    const noTotal = {
      timestamp: '2026-01-02T00:00:00Z',
      tag: 'future',
      scenario: 'bundle-size',
      metrics: { bundle_size: { client_js_kb: 1000, server_kb: 8000 } }, // total_kb gone
    };
    const files = {
      'good.json': JSON.stringify(run({ tag: 'g', ts: '2026-01-01T00:00:00Z' })),
      'noTotal.json': JSON.stringify(noTotal),
    };
    mock.method(io, 'readFileSync', (p) => files[p.split('/').pop()]);
    const runs = loadBundleRuns('/hist', io);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].tag, 'g');
  });

  test('a single malformed JSON file is skipped, not fatal', () => {
    mock.method(io, 'existsSync', () => true);
    mock.method(io, 'readdirSync', () => ['ok.json', 'broken.json']);
    const files = {
      'ok.json': JSON.stringify(run({ tag: 'ok', ts: '2026-01-01T00:00:00Z' })),
      'broken.json': '{ not valid json',
    };
    mock.method(io, 'readFileSync', (p) => files[p.split('/').pop()]);
    const runs = loadBundleRuns('/hist', io);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].tag, 'ok');
  });
});

describe('formatMarkdown', () => {
  test('includes header line, column headers, and one row per trend entry', () => {
    const trend = computeTrend([
      run({ tag: 'release-3.4', ts: '2026-01-01T00:00:00Z', client: 1124, server: 8920, total: 11240 }),
      run({ tag: 'release-3.5', ts: '2026-01-02T00:00:00Z', client: 1198, server: 8945, total: 11338 }),
    ]);
    const md = formatMarkdown(trend, { limit: 5, warnKb: 50 });
    assert.match(md, /## Bundle size trend \(last 5 runs of "bundle-size"\)/);
    assert.match(md, /\| Run \| Tag \| Client JS \| Server \| Total \| Δ vs prev \|/);
    assert.match(md, /\| 1 \| release-3.4 \| 1124 KB \| 8920 KB \| 11240 KB \| - \|/);
    assert.match(md, /\| 2 \| release-3.5 \| 1198 KB \| 8945 KB \| 11338 KB \| \+98 KB ⚠️ \|/);
  });

  test('delta below warnKb has no ⚠️ marker', () => {
    const trend = computeTrend([
      run({ tag: 'r1', ts: '2026-01-01T00:00:00Z', total: 9000 }),
      run({ tag: 'r1', ts: '2026-01-02T00:00:00Z', total: 9002 }),
    ]);
    const md = formatMarkdown(trend, { limit: 5, warnKb: 50 });
    assert.match(md, /\+2 KB \|/);
    assert.doesNotMatch(md, /⚠️/);
  });

  test('delta exactly at warnKb threshold triggers ⚠️ (>= boundary)', () => {
    const trend = computeTrend([
      run({ tag: 'r1', ts: '2026-01-01T00:00:00Z', total: 9000 }),
      run({ tag: 'r1', ts: '2026-01-02T00:00:00Z', total: 9050 }),
    ]);
    const md = formatMarkdown(trend, { limit: 5, warnKb: 50 });
    assert.match(md, /\+50 KB ⚠️/);
  });

  test('first row delta renders as "-"', () => {
    const md = formatMarkdown(
      computeTrend([run({ tag: 'r1', ts: '2026-01-01T00:00:00Z' })]),
      { limit: 5, warnKb: 50 }
    );
    assert.match(md, /\| 1 \| r1 \|.*\| - \|/);
  });
});

describe('formatJson', () => {
  test('returns object with trend key; first row delta_kb is null', () => {
    const trend = computeTrend([
      run({ tag: 'r1', ts: '2026-01-01T00:00:00Z', client: 1124, server: 8920, total: 11240 }),
      run({ tag: 'r2', ts: '2026-01-02T00:00:00Z', client: 1198, server: 8945, total: 11338 }),
    ]);
    const parsed = JSON.parse(formatJson(trend));
    assert.ok(Array.isArray(parsed.trend));
    assert.equal(parsed.trend.length, 2);
    assert.equal(parsed.trend[0].delta_kb, null);
    assert.equal(parsed.trend[1].delta_kb, 98);
    assert.deepEqual(Object.keys(parsed.trend[0]), ['tag', 'client_js_kb', 'server_kb', 'total_kb', 'delta_kb']);
  });
});
