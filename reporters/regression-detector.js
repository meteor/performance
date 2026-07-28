// Compares two benchmark result files and flags regressions against the
// thresholds configured in bench.config.js. Two exports:
//
//   compare(baseline, target) → { summary, details }
//     - Flattens the nested collector results (cpu, memory, gc, event-loop)
//       into a flat list of metric pairs keyed by a threshold name.
//     - For each pair: computes delta%, looks up the threshold in
//       bench.config.js (warn / fail bands), tags ok/WARN/FAIL.
//     - Emits explicit skip rows for unsafe pairs (missing on either side,
//       zero baseline, non-finite target) rather than silently dropping
//       them — the old silent-drop hid real collector-config drift.
//     - summary.passed === (failures === 0). Skip and WARN rows do NOT
//       fail the comparison so a CI bench.js compare exit code only goes
//       non-zero on threshold-crossing regressions.
//
//   toMarkdown(report) → string
//     - Renders the report as a markdown table with status icons. Skip
//       rows render `⏭ (<reason>)` so the reader can see which metrics
//       weren't comparable and why.

import config from '../bench.config.js';

function compare(baseline, target) {
  const details = [];
  let warnings = 0;
  let failures = 0;

  // Seed the comparison list with wall_clock — it lives at the top level of
  // the result, not under metrics{}, so it's special-cased before we walk
  // collector outputs below.
  const metricPairs = [
    { key: 'wall_clock_ms', baseVal: baseline.wall_clock_ms, targetVal: target.wall_clock_ms },
  ];

  // Each collector contributes one entry under target.metrics keyed by its
  // self-declared `metric` field (app_resources / db_resources / gc /
  // event_loop_delay). Walk the target's metrics and pull the matching
  // baseline; if baseline doesn't have that key we skip — typically means
  // the collector was disabled in the older run, not interesting.
  for (const [metricName, metricData] of Object.entries(target.metrics || {})) {
    const baseMetric = (baseline.metrics || {})[metricName];
    if (!baseMetric) continue;

    if (metricData.cpu) {
      metricPairs.push({
        key: 'cpu_avg_percent',
        label: `${metricData.name} CPU avg`,
        baseVal: baseMetric.cpu.avg,
        targetVal: metricData.cpu.avg,
      });
    }
    if (metricData.memory) {
      metricPairs.push({
        key: 'ram_avg_mb',
        label: `${metricData.name} RAM avg`,
        baseVal: baseMetric.memory.avg_mb,
        targetVal: metricData.memory.avg_mb,
      });
    }
    if (metricData.p99 !== undefined) {
      metricPairs.push({
        key: 'event_loop_p99_ms',
        label: 'Event loop p99',
        baseVal: baseMetric.p99,
        targetVal: metricData.p99,
      });
    }
    // GC metrics
    if (metricData.metric === 'gc' && baseMetric.metric === 'gc') {
      metricPairs.push({
        key: 'gc_total_pause_ms',
        label: 'GC total pause',
        baseVal: baseMetric.total_pause_ms,
        targetVal: metricData.total_pause_ms,
      });
      metricPairs.push({
        key: 'gc_max_pause_ms',
        label: 'GC max pause',
        baseVal: baseMetric.max_pause_ms,
        targetVal: metricData.max_pause_ms,
      });
      metricPairs.push({
        key: 'gc_count',
        label: 'GC count',
        baseVal: baseMetric.count,
        targetVal: metricData.count,
      });
      metricPairs.push({
        key: 'gc_major_ms',
        label: 'GC major (full)',
        baseVal: baseMetric.major.total_ms,
        targetVal: metricData.major.total_ms,
      });
    }
  }

  for (const { key, label, baseVal, targetVal } of metricPairs) {
    const metricName = label || key;

    // Missing on either side — the metric simply isn't comparable. Emit a
    // visible skip row instead of silently dropping it; the old behavior hid
    // collector-config drift (a metric present in baseline but missing in
    // target looked like nothing happened).
    if (baseVal == null || targetVal == null) {
      details.push({
        metric: metricName,
        status: 'skip',
        reason: 'missing_target',
        baseline: baseVal ?? null,
        target: targetVal ?? null,
      });
      continue;
    }

    // Zero baseline — a percentage delta against 0 is mathematically
    // undefined (any positive target would compute as Infinity). Skip
    // explicitly rather than emit a misleading number.
    if (baseVal === 0) {
      details.push({
        metric: metricName,
        status: 'skip',
        reason: 'zero_baseline',
        baseline: 0,
        target: targetVal,
      });
      continue;
    }

    // Non-finite target (NaN/Infinity/-Infinity) — flag explicitly rather
    // than letting the delta calculation propagate NaN downstream.
    if (!Number.isFinite(targetVal)) {
      details.push({
        metric: metricName,
        status: 'skip',
        reason: 'non_finite',
        baseline: baseVal,
        target: targetVal,
      });
      continue;
    }

    const delta = ((targetVal - baseVal) / baseVal) * 100;
    const threshold = config.thresholds[key];
    let status = 'ok';

    if (threshold) {
      if (delta > threshold.fail) {
        status = 'FAIL';
        failures++;
      } else if (delta > threshold.warn) {
        status = 'WARN';
        warnings++;
      }
    }

    details.push({
      metric: metricName,
      baseline: baseVal,
      target: targetVal,
      delta: +delta.toFixed(2),
      status,
    });
  }

  return {
    summary: {
      baseline_tag: baseline.tag,
      target_tag: target.tag,
      scenario: target.scenario,
      passed: failures === 0,
      warnings,
      failures,
    },
    details,
  };
}

const SKIP_REASON_TEXT = {
  zero_baseline: 'baseline was zero',
  missing_target: 'target metric missing',
  non_finite: 'target value non-finite',
};

function toMarkdown(report) {
  const { summary, details } = report;
  const icon = summary.passed ? (summary.warnings > 0 ? '⚠️' : '✅') : '❌';

  let md = `## ${icon} Benchmark: ${summary.scenario}\n\n`;
  md += `**${summary.baseline_tag}** → **${summary.target_tag}**\n\n`;

  if (details.length === 0) {
    md += `_No metrics compared._\n`;
    return md;
  }

  md += `| Metric | Baseline | Target | Delta | Status |\n`;
  md += `|--------|----------|--------|-------|--------|\n`;

  for (const d of details) {
    if (d.status === 'skip') {
      const reasonText = SKIP_REASON_TEXT[d.reason] || d.reason;
      const baselineCell = d.baseline ?? '';
      const targetCell = d.target ?? '';
      md += `| ${d.metric} | ${baselineCell} | ${targetCell} |  | ⏭ (${reasonText}) |\n`;
      continue;
    }
    const deltaStr = d.delta > 0 ? `+${d.delta}%` : `${d.delta}%`;
    const statusIcon = d.status === 'FAIL' ? '❌' : d.status === 'WARN' ? '⚠️' : '✅';
    md += `| ${d.metric} | ${d.baseline} | ${d.target} | ${deltaStr} | ${statusIcon} |\n`;
  }

  if (summary.failures > 0) {
    md += `\n**${summary.failures} regression(s) detected.** Performance threshold exceeded.\n`;
  }

  return md;
}

export { compare, toMarkdown };
