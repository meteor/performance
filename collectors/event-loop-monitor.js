/**
 * Event Loop Delay Monitor
 *
 * Uses Node.js built-in perf_hooks to measure event loop delay
 * with near-zero overhead. Outputs histogram percentiles at the end.
 *
 * Usage: Spawned by bench.js alongside the Meteor app.
 * Connects via IPC or writes JSON to stdout on SIGTERM.
 */

import { monitorEventLoopDelay } from 'node:perf_hooks';

const RESOLUTION_MS = 20; // histogram resolution in ms

const histogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
histogram.enable();

const collectResults = () => {
  histogram.disable();
  const results = {
    metric: 'event_loop_delay',
    unit: 'ms',
    min: histogram.min / 1e6,
    max: histogram.max / 1e6,
    mean: histogram.mean / 1e6,
    stddev: histogram.stddev / 1e6,
    p50: histogram.percentile(50) / 1e6,
    p95: histogram.percentile(95) / 1e6,
    p99: histogram.percentile(99) / 1e6,
    count: histogram.exceeds,
  };
  console.log(JSON.stringify(results));
};

process.on('SIGTERM', () => {
  collectResults();
  process.exit(0);
});

process.on('SIGINT', () => {
  collectResults();
  process.exit(0);
});

// Keep process alive
setInterval(() => {}, 60000);
