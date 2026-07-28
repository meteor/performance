// CJS: injected via SERVER_NODE_OPTIONS=--require which is CJS-only. Do not convert.

/**
 * GC Monitor
 *
 * Uses Node.js PerformanceObserver to track garbage collection events.
 * Reports total GC pause time, count, and breakdown by GC type.
 *
 * This script must run INSIDE the Meteor app process (not as a separate PID),
 * so it's designed to be injected via --require or SERVER_NODE_OPTIONS.
 *
 * Usage:
 *   SERVER_NODE_OPTIONS="--require /path/to/gc-monitor.cjs" meteor run
 *
 * On SIGTERM/SIGINT, writes JSON results to the file specified by
 * GC_MONITOR_OUTPUT env var (defaults to stdout).
 */

const { PerformanceObserver, constants } = require('node:perf_hooks');
const fs = require('fs');

const gcStats = {
  totalPauseMs: 0,
  count: 0,
  maxPauseMs: 0,
  byKind: {
    minor: { count: 0, totalMs: 0 },   // Scavenge (young generation)
    major: { count: 0, totalMs: 0 },   // Mark-Sweep-Compact (old generation)
    incremental: { count: 0, totalMs: 0 },
    weakcb: { count: 0, totalMs: 0 },  // Weak callback processing
  },
};

// Map GC flags to readable names
const GC_KINDS = {
  [constants.NODE_PERFORMANCE_GC_MINOR]: 'minor',
  [constants.NODE_PERFORMANCE_GC_MAJOR]: 'major',
  [constants.NODE_PERFORMANCE_GC_INCREMENTAL]: 'incremental',
  [constants.NODE_PERFORMANCE_GC_WEAKCB]: 'weakcb',
};

const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    const durationMs = entry.duration;
    const kind = GC_KINDS[entry.detail?.kind] || 'unknown';

    gcStats.totalPauseMs += durationMs;
    gcStats.count++;
    gcStats.maxPauseMs = Math.max(gcStats.maxPauseMs, durationMs);

    if (gcStats.byKind[kind]) {
      gcStats.byKind[kind].count++;
      gcStats.byKind[kind].totalMs += durationMs;
    }
  }
});

observer.observe({ type: 'gc', buffered: true });

const outputResults = () => {
  observer.disconnect();

  const results = {
    metric: 'gc',
    unit: 'ms',
    total_pause_ms: +gcStats.totalPauseMs.toFixed(2),
    count: gcStats.count,
    max_pause_ms: +gcStats.maxPauseMs.toFixed(2),
    avg_pause_ms: gcStats.count > 0 ? +(gcStats.totalPauseMs / gcStats.count).toFixed(2) : 0,
    minor: {
      count: gcStats.byKind.minor.count,
      total_ms: +gcStats.byKind.minor.totalMs.toFixed(2),
    },
    major: {
      count: gcStats.byKind.major.count,
      total_ms: +gcStats.byKind.major.totalMs.toFixed(2),
    },
    incremental: {
      count: gcStats.byKind.incremental.count,
      total_ms: +gcStats.byKind.incremental.totalMs.toFixed(2),
    },
    weakcb: {
      count: gcStats.byKind.weakcb.count,
      total_ms: +gcStats.byKind.weakcb.totalMs.toFixed(2),
    },
  };

  const outputPath = process.env.GC_MONITOR_OUTPUT;
  if (outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify(results) + '\n');
  } else {
    // Write to stderr to not interfere with Meteor's stdout
    process.stderr.write(`\n__GC_METRICS__${JSON.stringify(results)}__GC_METRICS__\n`);
  }
};

// Save periodically so data is available even if SIGTERM doesn't reach this process
const outputPath = process.env.GC_MONITOR_OUTPUT;
if (outputPath) {
  setInterval(() => {
    const snapshot = {
      metric: 'gc',
      unit: 'ms',
      total_pause_ms: +gcStats.totalPauseMs.toFixed(2),
      count: gcStats.count,
      max_pause_ms: +gcStats.maxPauseMs.toFixed(2),
      avg_pause_ms: gcStats.count > 0 ? +(gcStats.totalPauseMs / gcStats.count).toFixed(2) : 0,
      minor: { count: gcStats.byKind.minor.count, total_ms: +gcStats.byKind.minor.totalMs.toFixed(2) },
      major: { count: gcStats.byKind.major.count, total_ms: +gcStats.byKind.major.totalMs.toFixed(2) },
      incremental: { count: gcStats.byKind.incremental.count, total_ms: +gcStats.byKind.incremental.totalMs.toFixed(2) },
      weakcb: { count: gcStats.byKind.weakcb.count, total_ms: +gcStats.byKind.weakcb.totalMs.toFixed(2) },
    };
    try { fs.writeFileSync(outputPath, JSON.stringify(snapshot) + '\n'); } catch {}
  }, 5000).unref(); // unref so it doesn't keep the process alive
}

process.on('SIGTERM', outputResults);
process.on('SIGINT', outputResults);
process.on('beforeExit', outputResults);
