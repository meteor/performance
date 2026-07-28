#!/usr/bin/env node

/**
 * Publication Fanout Benchmark
 *
 * Measures the cost of reactive pub/sub fanout:
 * - N subscribers connect and subscribe to fetchTasks
 * - 1 writer inserts and removes tasks
 * - Measures time between write and last subscriber receiving the change
 *
 * Output: JSON with fanout latency stats (p50, p95, p99, avg, max)
 *
 * Usage:
 *   node tests/fanout-bench.js [--subscribers 100] [--writes 50] [--url http://localhost:3000]
 */

import SimpleDDP from 'simpleddp';
import ws from 'ws';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    subscribers: { type: 'string' },
    writes: { type: 'string' },
  },
  strict: false,
  allowPositionals: true,
});
const TARGET = values.url || process.env.REMOTE_URL || 'http://localhost:3000';
const NUM_SUBSCRIBERS = parseInt(values.subscribers || '100', 10);
const NUM_WRITES = parseInt(values.writes || '50', 10);

function wsUrl(httpUrl) {
  return httpUrl.replace(/^http/, 'ws') + '/websocket';
}

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function run() {
  const endpoint = wsUrl(TARGET);
  console.error(`Fanout benchmark: ${NUM_SUBSCRIBERS} subscribers, ${NUM_WRITES} writes`);
  console.error(`Target: ${endpoint}`);

  // Phase 1: Connect subscribers
  console.error('Connecting subscribers...');
  const subscribers = [];
  for (let i = 0; i < NUM_SUBSCRIBERS; i++) {
    const ddp = new SimpleDDP({ endpoint, SocketConstructor: ws, reconnectInterval: 5000 });
    await ddp.connect();
    const sub = ddp.subscribe('fetchTasks');
    await sub.ready();
    subscribers.push(ddp);
    if ((i + 1) % 25 === 0) console.error(`  ${i + 1}/${NUM_SUBSCRIBERS} connected`);
  }
  console.error(`All ${NUM_SUBSCRIBERS} subscribers ready`);

  // Phase 2: Connect writer
  const writer = new SimpleDDP({ endpoint, SocketConstructor: ws, reconnectInterval: 5000 });
  await writer.connect();
  const sessionId = crypto.randomUUID();

  // Phase 3: Measure fanout latency
  // For each write, measure how long until the last subscriber sees the change
  console.error('Starting write phase...');
  const fanoutLatencies = [];

  for (let w = 0; w < NUM_WRITES; w++) {
    // Track when each subscriber receives the added event
    let receivedCount = 0;
    const writeStart = process.hrtime.bigint();
    let lastReceived = writeStart;

    const waitPromise = new Promise((resolve) => {
      for (const sub of subscribers) {
        const reactiveCol = sub.collection('taskCollection').reactive();
        const handler = reactiveCol.onChange((newData) => {
          // Check if any new document matches our session
          const found = Array.isArray(newData)
            ? newData.some(doc => doc.sessionId === sessionId)
            : newData && newData.sessionId === sessionId;
          if (found) {
            receivedCount++;
            lastReceived = process.hrtime.bigint();
            handler.stop();
            if (receivedCount >= NUM_SUBSCRIBERS) {
              resolve();
            }
          }
        });
      }

      // Timeout after 10s
      setTimeout(() => resolve(), 10000);
    });

    // Insert a task
    await writer.call('insertTask', {
      description: `fanout-${w}`,
      sessionId,
    });

    await waitPromise;

    const latencyNs = Number(lastReceived - writeStart);
    const latencyMs = latencyNs / 1_000_000;
    fanoutLatencies.push(latencyMs);

    if ((w + 1) % 10 === 0) {
      console.error(`  Write ${w + 1}/${NUM_WRITES}: ${latencyMs.toFixed(1)}ms fanout (${receivedCount}/${NUM_SUBSCRIBERS} received)`);
    }
  }

  // Cleanup
  console.error('Cleaning up...');
  await writer.call('removeAllTasks', { sessionId });
  writer.disconnect();
  for (const sub of subscribers) sub.disconnect();

  // Compute stats
  const sorted = [...fanoutLatencies].sort((a, b) => a - b);
  const avg = fanoutLatencies.reduce((a, b) => a + b, 0) / fanoutLatencies.length;

  const result = {
    subscribers: NUM_SUBSCRIBERS,
    writes: NUM_WRITES,
    fanout_avg_ms: Math.round(avg * 100) / 100,
    fanout_p50_ms: Math.round(percentile(sorted, 50) * 100) / 100,
    fanout_p95_ms: Math.round(percentile(sorted, 95) * 100) / 100,
    fanout_p99_ms: Math.round(percentile(sorted, 99) * 100) / 100,
    fanout_max_ms: Math.round(sorted[sorted.length - 1] * 100) / 100,
    fanout_min_ms: Math.round(sorted[0] * 100) / 100,
    raw_latencies: fanoutLatencies.map(l => Math.round(l * 100) / 100),
  };

  console.error(`\nFanout results: avg=${result.fanout_avg_ms}ms p50=${result.fanout_p50_ms}ms p95=${result.fanout_p95_ms}ms max=${result.fanout_max_ms}ms`);

  // Output JSON to stdout (bench.js captures this)
  console.log(JSON.stringify(result));
}

run().catch((err) => {
  console.error('Fanout benchmark failed:', err);
  process.exit(1);
});
