// Samples Meteor's active observe()/observeChanges() multiplexer pool at
// a fixed interval. Each sample records two counts:
//
//   muxCount    — number of distinct cursor descriptions being observed.
//                 Meteor DEDUPES: 100 clients all subscribing to the same
//                 Tasks.find() share ONE multiplexer. So this is the count
//                 of unique reactive queries, the most direct measure of
//                 pub/sub pressure (and observer leaks — a count that keeps
//                 climbing in steady state means something isn't cleaned up).
//   handleCount — sum of live observe handles across all multiplexers =
//                 number of distinct subscriptions in flight (one per
//                 client × cursor).
//
// Surfaces as `metrics.observer_pool` (min/max/avg/end for both counts).
// This file dumps RAW samples; the harness aggregates in
// runner/observer-pool-aggregator.js.
//
// SERVER access path (REVISIONS.md task 05): the multiplexer map lives at
// MongoInternals.defaultRemoteCollectionDriver().mongo._observeMultiplexers.
// NOT Meteor.connection._mongoConnection._observeMultiplexers — that's the
// CLIENT API and is always undefined on the server.
//
// Handle counting: a multiplexer's `_handles` is a PLAIN OBJECT keyed by
// handle id (mongo/observe_multiplex.ts:48 `this._handles = {}`), NOT an
// array — so we count via Object.keys, not `.length` (the REVISIONS sketch
// used `._handles?.length`, which is always undefined on an object). The
// field is set to `null` when a multiplexer is torn down
// (observe_multiplex.ts:125), so we guard the null case → 0 handles.
//
// _observeMultiplexers is internal API (same fragility as the runtime-info
// observer-driver probe). If Meteor renames it we read an empty map and
// report zeros — we never crash the app.
//
// Samples cap at MAX_SAMPLES (10_000) to bound memory on long benchmarks:
// at the default 1 s interval that's ~2.7 h of headroom; past the cap we
// drop the OLDEST sample so the window always reflects recent state.
//
// Gated entirely on OBSERVER_POOL_OUTPUT — without the env var the init is
// a complete no-op (no interval, zero overhead). The harness sets the env
// in benchmark runs only.

import { MongoInternals } from 'meteor/mongo';
import { installDumpOnShutdown } from './_dump-on-shutdown';

const DEFAULT_INTERVAL_MS = 1000;
const MAX_SAMPLES = 10_000;

const samples = []; // [{ ts, muxCount, handleCount }]

function snapshot() {
  const mongo = MongoInternals.defaultRemoteCollectionDriver().mongo;
  const muxers = mongo._observeMultiplexers || {};
  let muxCount = 0;
  let handleCount = 0;
  for (const key in muxers) {
    muxCount++;
    const handles = muxers[key]?._handles;
    if (handles) handleCount += Object.keys(handles).length;
  }
  return { muxCount, handleCount };
}

let started = false;
let timer = null;

export function initObserverPoolSampler() {
  if (started) return;
  const outputPath = process.env.OBSERVER_POOL_OUTPUT;
  if (!outputPath) return;
  started = true;

  const intervalMs = Number(process.env.OBSERVER_POOL_INTERVAL_MS) || DEFAULT_INTERVAL_MS;

  timer = setInterval(() => {
    const { muxCount, handleCount } = snapshot();
    samples.push({ ts: Date.now(), muxCount, handleCount });
    if (samples.length > MAX_SAMPLES) samples.shift();
  }, intervalMs);
  timer.unref(); // don't keep the event loop alive past natural exit

  installDumpOnShutdown(outputPath, () => ({ interval_ms: intervalMs, samples }), 'observer-pool');
}
