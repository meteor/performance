/**
 * Process Monitor — CPU/RAM collector
 *
 * Modernized version of scripts/helpers/monitor-cpu-ram.js.
 * Outputs JSON results on SIGTERM for machine-readable consumption.
 * Also prints periodic human-readable updates to stderr.
 */

import pidusage from 'pidusage';

const INTERVAL_MS = 1000;

const pid = parseInt(process.argv[2], 10);
const name = process.argv[3] || 'PROCESS';

if (!pid) {
  console.error('Usage: node process-monitor.js <PID> [name]');
  process.exit(1);
}

const samples = [];
let totalCpu = 0;
let totalMemory = 0;
let maxCpu = 0;
let maxMemory = 0;
let count = 0;

const collect = async () => {
  try {
    const stats = await pidusage(pid);
    samples.push({ cpu: stats.cpu, memory: stats.memory, ts: Date.now() });
    totalCpu += stats.cpu;
    totalMemory += stats.memory;
    maxCpu = Math.max(maxCpu, stats.cpu);
    maxMemory = Math.max(maxMemory, stats.memory);
    count++;

    if (count % 10 === 0) {
      process.stderr.write(`${name} | CPU: ${stats.cpu.toFixed(1)}% RAM: ${(stats.memory / 1024 / 1024).toFixed(1)}MB\n`);
    }
  } catch {
    outputResults();
    process.exit(0);
  }
};

const outputResults = () => {
  if (count === 0) return;
  const results = {
    metric: `${name.toLowerCase()}_resources`,
    name,
    pid,
    samples: count,
    cpu: {
      avg: +(totalCpu / count).toFixed(2),
      max: +maxCpu.toFixed(2),
      unit: 'percent',
    },
    memory: {
      avg_mb: +(totalMemory / count / 1024 / 1024).toFixed(2),
      max_mb: +(maxMemory / 1024 / 1024).toFixed(2),
      unit: 'MB',
    },
  };
  console.log(JSON.stringify(results));
};

const intervalId = setInterval(collect, INTERVAL_MS);

const shutdown = () => {
  clearInterval(intervalId);
  outputResults();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
