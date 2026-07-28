// `bundle-delta` — OFFLINE trend tool, NOT a metric collector. Reads the
// already-saved result history (config.results.history), keeps the
// `bundle-size` runs, sorts by timestamp, and prints a Δ table (markdown
// default, or JSON via --format json) so an operator can spot bundle bloat
// across runs without grep/jq dances over the history dir.
//
// Forward-compatible by construction: it only reads `metrics.bundle_size`
// and the top-level scenario/tag/timestamp. A history file from an older
// (or newer) harness version is still valid here — every other field is
// ignored, so new metrics or runtime fields never break this command.
//
// Split into pure helpers (computeTrend/formatMarkdown/formatJson) plus a
// thin loader (loadBundleRuns) that takes the io facade as a parameter, so
// the unit tests can mock readdirSync/readFileSync without real disk.

import path from 'node:path';
import { io } from '../runner/_io.js';

const DEFAULT_LIMIT = 5;
const DEFAULT_WARN_KB = 50;

// Read every *.json in historyDir through the injected reader, parse, and
// keep only well-formed bundle-size runs. A file that fails to parse or
// lacks the bundle_size shape is skipped rather than fatal — one bad file
// in a long history shouldn't sink the whole trend.
export function loadBundleRuns(historyDir, reader = io) {
  if (!reader.existsSync(historyDir)) return [];
  const runs = [];
  for (const name of reader.readdirSync(historyDir)) {
    if (!name.endsWith('.json')) continue;
    let parsed;
    try {
      parsed = JSON.parse(reader.readFileSync(path.join(historyDir, name), 'utf8'));
    } catch {
      continue;
    }
    if (isBundleSizeRun(parsed)) runs.push(parsed);
  }
  return runs;
}

// A usable row needs scenario === 'bundle-size' AND a numeric total_kb.
// The total_kb guard is the forward-compat hinge: if a future shape change
// renames the field, the run is skipped instead of producing NaN deltas.
function isBundleSizeRun(r) {
  return !!r
    && r.scenario === 'bundle-size'
    && typeof r?.metrics?.bundle_size?.total_kb === 'number';
}

// Pure: array of run objects in, array of trend rows out. Sorts ascending
// by timestamp, slices to the most-recent `limit`, then walks the window
// computing delta_kb vs the previous row (null for the first row). The ⚠️
// marker is a formatting concern, applied in formatMarkdown — these rows
// stay a clean data contract (delta_kb is number|null).
export function computeTrend(runs, { limit = DEFAULT_LIMIT } = {}) {
  const sorted = [...runs].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const windowed = limit > 0 ? sorted.slice(-limit) : sorted;
  return windowed.map((run, i) => {
    const b = run.metrics.bundle_size;
    return {
      tag: run.tag,
      client_js_kb: b.client_js_kb,
      server_kb: b.server_kb,
      total_kb: b.total_kb,
      delta_kb: i === 0 ? null : b.total_kb - windowed[i - 1].metrics.bundle_size.total_kb,
    };
  });
}

function fmtDelta(deltaKb, warnKb) {
  if (deltaKb === null || deltaKb === undefined) return '-';
  const sign = deltaKb >= 0 ? '+' : '';
  const marker = deltaKb >= warnKb ? ' ⚠️' : '';
  return `${sign}${deltaKb} KB${marker}`;
}

// Renders the trend as a GitHub-flavored markdown table. The ⚠️ marker is
// derived here (delta_kb >= warnKb) so it never leaks into the JSON shape.
export function formatMarkdown(trend, { limit = DEFAULT_LIMIT, warnKb = DEFAULT_WARN_KB } = {}) {
  const lines = [];
  lines.push(`## Bundle size trend (last ${limit} runs of "bundle-size")`);
  lines.push('');
  lines.push('| Run | Tag | Client JS | Server | Total | Δ vs prev |');
  lines.push('|-----|-----|-----------|--------|-------|-----------|');
  trend.forEach((row, i) => {
    lines.push(
      `| ${i + 1} | ${row.tag} | ${row.client_js_kb} KB | ${row.server_kb} KB | ${row.total_kb} KB | ${fmtDelta(row.delta_kb, warnKb)} |`
    );
  });
  return lines.join('\n');
}

export function formatJson(trend) {
  return JSON.stringify({ trend }, null, 2);
}

// CLI entry. Coerces the string flags from parseArgs to numbers, loads the
// runs, and prints either the friendly empty-state line or the chosen format.
// Always exits 0 — an empty history is a normal state, not an error.
export function runBundleDelta({ values, config }) {
  const limit = Number(values.limit ?? DEFAULT_LIMIT);
  const warnKb = Number(values['warn-kb'] ?? DEFAULT_WARN_KB);
  const format = values.format || 'markdown';
  const historyDir = config.results.history;

  const runs = loadBundleRuns(historyDir, io);
  if (runs.length === 0) {
    console.log(`No bundle-size runs found in ${historyDir}`);
    return;
  }

  const trend = computeTrend(runs, { limit });
  console.log(format === 'json' ? formatJson(trend) : formatMarkdown(trend, { limit, warnKb }));
}
