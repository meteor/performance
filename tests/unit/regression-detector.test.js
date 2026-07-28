import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { compare, toMarkdown } from '../../reporters/regression-detector.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const load = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
const clone = (obj) => JSON.parse(JSON.stringify(obj));

describe('compare() — happy paths', () => {
  test('passing run: all deltas under warn thresholds', () => {
    const report = compare(load('baseline.json'), load('target.json'));
    assert.equal(report.summary.passed, true);
    assert.equal(report.summary.failures, 0);
    assert.equal(report.summary.warnings, 0);
    assert.equal(report.summary.baseline_tag, 'v3.5-baseline');
    assert.equal(report.summary.target_tag, 'devel-pass');
    assert.equal(report.summary.scenario, 'reactive-light');
    for (const d of report.details) assert.equal(d.status, 'ok');
    // deltas are rounded to 2 decimals
    for (const d of report.details) {
      assert.equal(d.delta, +d.delta.toFixed(2));
    }
  });

  test('regression run: multiple FAIL crossings', () => {
    const report = compare(load('baseline.json'), load('target-regression.json'));
    assert.equal(report.summary.passed, false);
    assert.ok(report.summary.failures >= 3, `expected >=3 failures, got ${report.summary.failures}`);
    // wall_clock_ms 40000 -> 52000 is +30% (threshold fail=25)
    const wall = report.details.find((d) => d.metric === 'wall_clock_ms');
    assert.equal(wall.status, 'FAIL');
    assert.equal(wall.delta, 30);
    // APP CPU avg 20 -> 28 is +40% (threshold fail=30)
    const cpu = report.details.find((d) => d.metric === 'APP CPU avg');
    assert.equal(cpu.status, 'FAIL');
    assert.equal(cpu.delta, 40);
    // GC total pause 200 -> 320 is +60% (threshold fail=50)
    const gc = report.details.find((d) => d.metric === 'GC total pause');
    assert.equal(gc.status, 'FAIL');
    assert.equal(gc.delta, 60);
  });

  test('improvement run: every delta negative, all ok', () => {
    const report = compare(load('baseline.json'), load('target-improvement.json'));
    assert.equal(report.summary.passed, true);
    assert.equal(report.summary.failures, 0);
    assert.equal(report.summary.warnings, 0);
    for (const d of report.details) {
      assert.ok(d.delta < 0, `${d.metric} delta ${d.delta} should be negative`);
      assert.equal(d.status, 'ok');
    }
  });

  test('warn threshold crossed (wall_clock +15% with warn=10 fail=25)', () => {
    const baseline = load('baseline.json');
    const target = clone(load('target.json'));
    target.wall_clock_ms = baseline.wall_clock_ms * 1.15;
    // Strip non-wall_clock metric pairs to keep the assertion focused.
    target.metrics = {};
    const report = compare(baseline, target);
    assert.equal(report.summary.passed, true);
    assert.equal(report.summary.warnings, 1);
    assert.equal(report.summary.failures, 0);
    assert.equal(report.details[0].status, 'WARN');
  });

  test('mixed pass+warn+fail in one report', () => {
    const baseline = load('baseline.json');
    const target = clone(baseline);
    target.tag = 'mixed';
    target.wall_clock_ms = baseline.wall_clock_ms * 1.05;                                    // +5% ok
    target.metrics.app_resources.cpu.avg = baseline.metrics.app_resources.cpu.avg * 1.20;    // +20% WARN
    target.metrics.gc.total_pause_ms = baseline.metrics.gc.total_pause_ms * 1.60;            // +60% FAIL
    const report = compare(baseline, target);
    assert.ok(report.details.some((d) => d.metric === 'wall_clock_ms' && d.status === 'ok'));
    assert.ok(report.details.some((d) => d.metric === 'APP CPU avg' && d.status === 'WARN'));
    assert.ok(report.details.some((d) => d.metric === 'GC total pause' && d.status === 'FAIL'));
    assert.equal(report.summary.passed, false);
    assert.ok(report.summary.warnings >= 1);
    assert.ok(report.summary.failures >= 1);
  });
});

describe('compare() — edge cases (no metric pair produced at all)', () => {
  test('metric deleted from target.metrics: no row at all (the pair was never built)', () => {
    const target = clone(load('target.json'));
    delete target.metrics.gc;
    const report = compare(load('baseline.json'), target);
    assert.equal(report.summary.passed, true);
    assert.ok(!report.details.some((d) => d.metric === 'GC total pause'));
    assert.ok(!report.details.some((d) => d.metric === 'GC max pause'));
  });

  test('metric deleted from baseline.metrics: pair skipped via `if (!baseMetric) continue`', () => {
    const baseline = clone(load('baseline.json'));
    delete baseline.metrics.event_loop_delay;
    const report = compare(baseline, load('target.json'));
    assert.ok(!report.details.some((d) => d.metric === 'Event loop p99'));
  });

  test('event_loop_delay p99 pair is produced when both sides present', () => {
    const report = compare(load('baseline.json'), load('target.json'));
    const p99 = report.details.find((d) => d.metric === 'Event loop p99');
    assert.ok(p99, 'expected an Event loop p99 detail row');
    assert.equal(p99.baseline, 10.0);
    assert.equal(p99.target, 10.5);
  });

  test('DB resources pair is produced (separate from APP)', () => {
    const report = compare(load('baseline.json'), load('target.json'));
    assert.ok(report.details.some((d) => d.metric === 'APP CPU avg'));
    assert.ok(report.details.some((d) => d.metric === 'DB CPU avg'));
    assert.ok(report.details.some((d) => d.metric === 'APP RAM avg'));
    assert.ok(report.details.some((d) => d.metric === 'DB RAM avg'));
  });

  test('empty target.metrics: only the wall_clock pair survives', () => {
    const target = clone(load('target.json'));
    target.metrics = {};
    const report = compare(load('baseline.json'), target);
    assert.equal(report.details.length, 1);
    assert.equal(report.details[0].metric, 'wall_clock_ms');
  });

  test('missing target.metrics entirely: only wall_clock pair, no crash', () => {
    const target = clone(load('target.json'));
    delete target.metrics;
    const report = compare(load('baseline.json'), target);
    assert.equal(report.details.length, 1);
    assert.equal(report.details[0].metric, 'wall_clock_ms');
  });
});

describe('compare() — skip rows (commit 11 bug fix)', () => {
  test('baseVal === 0 → skip row with reason: "zero_baseline" (no Infinity delta)', () => {
    const baseline = clone(load('baseline.json'));
    baseline.metrics.gc.total_pause_ms = 0;
    const report = compare(baseline, load('target.json'));
    const row = report.details.find((d) => d.metric === 'GC total pause');
    assert.ok(row, 'GC total pause should now produce a visible row (was silently dropped before commit 11)');
    assert.equal(row.status, 'skip');
    assert.equal(row.reason, 'zero_baseline');
    assert.equal(row.baseline, 0);
    assert.equal(row.target, load('target.json').metrics.gc.total_pause_ms);
  });

  test('end-to-end via baseline-with-zero.json fixture (wall_clock_ms: 0) → wall_clock skip row', () => {
    const report = compare(load('baseline-with-zero.json'), load('target.json'));
    const row = report.details.find((d) => d.metric === 'wall_clock_ms');
    assert.ok(row);
    assert.equal(row.status, 'skip');
    assert.equal(row.reason, 'zero_baseline');
    assert.equal(row.baseline, 0);
  });

  test('targetVal null (target-non-finite.json fixture) → skip row with reason: "missing_target"', () => {
    // app_resources.cpu.avg is null in the fixture; the cpu pair gets built
    // with targetVal=null, which trips the missing_target branch (== null
    // catches both null and undefined, in that order before zero/non_finite).
    const report = compare(load('baseline.json'), load('target-non-finite.json'));
    const row = report.details.find((d) => d.metric === 'APP CPU avg');
    assert.ok(row, 'APP CPU avg row should now be visible (was silently dropped before commit 11)');
    assert.equal(row.status, 'skip');
    assert.equal(row.reason, 'missing_target');
    assert.equal(row.target, null);
    // RAM and GC are still finite → normal ok rows.
    const ram = report.details.find((d) => d.metric === 'APP RAM avg');
    assert.equal(ram.status, 'ok');
  });

  test('NaN target value → skip row with reason: "non_finite"', () => {
    const target = clone(load('target.json'));
    target.metrics.app_resources.cpu.avg = NaN;
    const report = compare(load('baseline.json'), target);
    const row = report.details.find((d) => d.metric === 'APP CPU avg');
    assert.ok(row);
    assert.equal(row.status, 'skip');
    assert.equal(row.reason, 'non_finite');
    // delta is NOT computed for skip rows.
    assert.equal(row.delta, undefined);
  });

  test('Infinity target value → skip row with reason: "non_finite" (no longer a misleading FAIL)', () => {
    const target = clone(load('target.json'));
    target.metrics.app_resources.cpu.avg = Infinity;
    const report = compare(load('baseline.json'), target);
    const row = report.details.find((d) => d.metric === 'APP CPU avg');
    assert.ok(row);
    assert.equal(row.status, 'skip');
    assert.equal(row.reason, 'non_finite');
  });

  test('-Infinity target value → skip row with reason: "non_finite"', () => {
    const target = clone(load('target.json'));
    target.metrics.app_resources.cpu.avg = -Infinity;
    const report = compare(load('baseline.json'), target);
    const row = report.details.find((d) => d.metric === 'APP CPU avg');
    assert.ok(row);
    assert.equal(row.status, 'skip');
    assert.equal(row.reason, 'non_finite');
  });

  test('skip-detection order: missing_target wins over zero_baseline (both conditions true)', () => {
    // baseline gc.total_pause_ms = 0 AND target gc.total_pause_ms = null
    // The `baseVal == null || targetVal == null` check runs FIRST in
    // compare(), so we expect missing_target, not zero_baseline.
    const baseline = clone(load('baseline.json'));
    baseline.metrics.gc.total_pause_ms = 0;
    const target = clone(load('target.json'));
    target.metrics.gc.total_pause_ms = null;
    const report = compare(baseline, target);
    const row = report.details.find((d) => d.metric === 'GC total pause');
    assert.equal(row.status, 'skip');
    assert.equal(row.reason, 'missing_target');
  });
});

describe('compare() — exit-code semantics (skip rows do NOT count as failures)', () => {
  test('skip-only run (no ok/warn/fail rows) → passed: true, failures: 0', () => {
    // Construct a comparison where every pair is a skip: wall_clock zero baseline
    // + APP CPU null target + GC NaN target. No rows should be ok/warn/fail.
    const baseline = clone(load('baseline-with-zero.json')); // wall_clock_ms: 0
    const target = clone(load('target.json'));
    target.metrics.app_resources.cpu.avg = null;
    target.metrics.gc.total_pause_ms = NaN;
    const report = compare(baseline, target);
    assert.equal(report.summary.passed, true);
    assert.equal(report.summary.failures, 0);
    assert.equal(report.summary.warnings, 0);
    // Confirm at least one skip row exists.
    assert.ok(report.details.some((d) => d.status === 'skip'));
  });

  test('mixed skip + ok rows → passed: true (skips do not pollute pass/fail)', () => {
    const baseline = clone(load('baseline.json'));
    baseline.metrics.gc.total_pause_ms = 0; // skip
    const report = compare(baseline, load('target.json'));
    assert.equal(report.summary.passed, true);
    assert.equal(report.summary.failures, 0);
    assert.ok(report.details.some((d) => d.status === 'skip'));
    assert.ok(report.details.some((d) => d.status === 'ok'));
  });

  test('mixed skip + FAIL → passed: false (skip never cancels a real failure)', () => {
    const baseline = clone(load('baseline.json'));
    baseline.metrics.gc.total_pause_ms = 0; // skip
    const target = clone(load('target.json'));
    target.wall_clock_ms = baseline.wall_clock_ms * 1.40; // +40% FAIL
    const report = compare(baseline, target);
    assert.equal(report.summary.passed, false);
    assert.ok(report.summary.failures >= 1);
    assert.ok(report.details.some((d) => d.status === 'skip'));
    assert.ok(report.details.some((d) => d.status === 'FAIL'));
  });
});

describe('toMarkdown()', () => {
  test('passing report renders ✅ header and table', () => {
    const md = toMarkdown(compare(load('baseline.json'), load('target.json')));
    assert.match(md, /^## ✅ Benchmark: reactive-light/);
    assert.match(md, /\*\*v3\.5-baseline\*\* → \*\*devel-pass\*\*/);
    assert.match(md, /\| Metric \| Baseline \| Target \| Delta \| Status \|/);
    assert.match(md, /\|--------\|----------\|--------\|-------\|--------\|/);
  });

  test('regression report renders ❌ header and regression line', () => {
    const md = toMarkdown(compare(load('baseline.json'), load('target-regression.json')));
    assert.match(md, /^## ❌ Benchmark: reactive-light/);
    assert.match(md, /\*\*\d+ regression\(s\) detected\.\*\* Performance threshold exceeded\./);
  });

  test('warning-only report renders ⚠️ header', () => {
    const baseline = load('baseline.json');
    const target = clone(baseline);
    target.tag = 'warn-only';
    target.wall_clock_ms = baseline.wall_clock_ms * 1.15;
    target.metrics = {};
    const md = toMarkdown(compare(baseline, target));
    assert.match(md, /^## ⚠️ Benchmark:/);
    assert.doesNotMatch(md, /regression\(s\) detected/);
  });

  test('positive delta renders with + prefix', () => {
    const md = toMarkdown(compare(load('baseline.json'), load('target.json')));
    assert.match(md, /\+\d+(\.\d+)?%/);
  });

  test('negative delta renders without + prefix (just the - sign)', () => {
    const md = toMarkdown(compare(load('baseline.json'), load('target-improvement.json')));
    assert.match(md, /-\d+(\.\d+)?%/);
    // sanity: no "+-" artifact
    assert.doesNotMatch(md, /\+-/);
  });

  test('status icons: FAIL → ❌, WARN → ⚠️, ok → ✅', () => {
    const baseline = load('baseline.json');
    const target = clone(baseline);
    target.tag = 'icon-mix';
    target.wall_clock_ms = baseline.wall_clock_ms * 1.05;                                    // ok
    target.metrics.app_resources.cpu.avg = baseline.metrics.app_resources.cpu.avg * 1.20;    // WARN
    target.metrics.gc.total_pause_ms = baseline.metrics.gc.total_pause_ms * 1.60;            // FAIL
    const md = toMarkdown(compare(baseline, target));
    // The header carries the overall-status icon (❌ because there's a FAIL),
    // so check the per-row table cells specifically.
    assert.ok(md.includes('| wall_clock_ms |'));
    assert.ok(md.includes('| APP CPU avg |'));
    assert.ok(md.includes('| GC total pause |'));
    assert.match(md, /\| GC total pause \| .* \| ❌ \|/);
    assert.match(md, /\| APP CPU avg \| .* \| ⚠️ \|/);
    assert.match(md, /\| wall_clock_ms \| .* \| ✅ \|/);
  });

  test('skip row renders with its reason text visible (zero_baseline)', () => {
    const baseline = clone(load('baseline.json'));
    baseline.metrics.gc.total_pause_ms = 0;
    const md = toMarkdown(compare(baseline, load('target.json')));
    assert.match(md, /\| GC total pause \|.*baseline was zero.*\|/);
  });

  test('skip row renders with its reason text visible (missing_target)', () => {
    const md = toMarkdown(compare(load('baseline.json'), load('target-non-finite.json')));
    assert.match(md, /\| APP CPU avg \|.*target metric missing.*\|/);
  });

  test('skip row renders with its reason text visible (non_finite)', () => {
    const target = clone(load('target.json'));
    target.metrics.app_resources.cpu.avg = Infinity;
    const md = toMarkdown(compare(load('baseline.json'), target));
    assert.match(md, /\| APP CPU avg \|.*target value non-finite.*\|/);
  });

  test('skip row does NOT count toward the "regression(s) detected" footer', () => {
    // Skip-only run → no failures → no footer.
    const baseline = clone(load('baseline-with-zero.json'));
    const target = clone(load('target.json'));
    const md = toMarkdown(compare(baseline, target));
    assert.doesNotMatch(md, /regression\(s\) detected/);
  });

  test('empty details renders explicit "No metrics compared." line, no table header', () => {
    const md = toMarkdown({
      summary: { baseline_tag: 'a', target_tag: 'b', scenario: 'empty', passed: true, warnings: 0, failures: 0 },
      details: [],
    });
    assert.match(md, /^## ✅ Benchmark: empty/);
    assert.match(md, /No metrics compared\./);
    assert.doesNotMatch(md, /\| Metric \| Baseline \| Target \| Delta \| Status \|/);
    assert.doesNotMatch(md, /regression\(s\) detected/);
  });
});
