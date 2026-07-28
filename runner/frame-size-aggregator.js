// Pure aggregation for the frame-size monitor — extracted from the in-app
// monitor's raw dump so it's unit-testable without a Meteor server.
//
// Input: the dump written by frame-size-counter.server.js —
//   { in_sizes: number[], out_sizes: number[],
//     by_type_in_sum: {type: bytes}, by_type_out_sum: {type: bytes} }
// (RAW per-message byte sizes + per-type byte sums.)
// Output: the `metrics.ddp_frame_size` shape — size distribution per
// direction plus the per-type byte-sum breakdown.
//
// Percentiles come from the shared lib/percentiles.js `summarize` (CC-1) so
// rounding + nearest-rank method match every other distribution metric.
//
// Field naming (CC-4): percentile names here carry a `_bytes` SUFFIX —
// `p50_bytes`, `p95_bytes`, `p99_bytes` — NOT the bare `p50/p95/p99` form.
// The bare convention exists specifically to match the shipped
// `event_loop_delay` contract, whose percentiles are in MILLISECONDS. These
// percentiles are in BYTES, so the unit suffix is required to avoid implying
// ms. (Same rule the spec README states: bare for ms percentiles, domain
// suffix otherwise.) avg_bytes / max_bytes likewise carry the unit.
//
// Absence (CC-5): returns null when NO messages were seen in either
// direction (both size arrays empty) so the caller omits the metric key.

import { summarize } from '../lib/percentiles.js';

function directionStats(sizes) {
  const stats = summarize(sizes);
  if (!stats) return { count: 0, avg_bytes: 0, p50_bytes: 0, p95_bytes: 0, p99_bytes: 0, max_bytes: 0 };
  return {
    count: stats.count,
    avg_bytes: +stats.avg.toFixed(1),
    p50_bytes: stats.p50,
    p95_bytes: stats.p95,
    p99_bytes: stats.p99,
    max_bytes: stats.max,
  };
}

export function aggregateFrameSize(dump) {
  if (!dump) return null;
  const inSizes = Array.isArray(dump.in_sizes) ? dump.in_sizes : [];
  const outSizes = Array.isArray(dump.out_sizes) ? dump.out_sizes : [];
  if (inSizes.length === 0 && outSizes.length === 0) return null;

  return {
    metric: 'ddp_frame_size',
    in: directionStats(inSizes),
    out: directionStats(outSizes),
    by_type_bytes: {
      in: { ...(dump.by_type_in_sum || {}) },
      out: { ...(dump.by_type_out_sum || {}) },
    },
  };
}
