// Records the observe-driver Meteor actually selects for EACH cursor
// (not just the one-shot startup probe in server/main.js — that only
// reflects the FIRST observe). When Meteor's preferred driver isn't
// available for a specific cursor (e.g. cursor opted out via
// disableOplog, or the query shape blocks change-streams), Meteor falls
// through to the next driver. This metric surfaces those per-cursor
// silent fallbacks so a benchmark labeled "oplog" doesn't quietly run
// 30% polling.
//
// Surfaces as `metrics.driver_fallbacks`.
//
// REVISIONS.md task 10 fix: do NOT wrap `_selectReactivityDriver` —
// polling fallback happens in `_observeChanges` AT mongo_connection.js:1188,
// OUTSIDE the selector. The actual driver instance Meteor ended up
// using is on `handle._multiplexer._observeDriver` (same internal the
// startup probe reads). Hook the connection-instance `_observeChanges`
// and inspect the returned handle per observe call.
//
// Gated entirely on DRIVER_FALLBACK_OUTPUT — without the env var the
// init is a no-op (no wrap, zero per-observe overhead).

import { MongoInternals } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { installDumpOnShutdown } from './_dump-on-shutdown';

const DRIVER_CLASS_TO_NAME = {
  ChangeStreamObserveDriver: 'changeStreams',
  OplogObserveDriver: 'oplog',
  PollingObserveDriver: 'polling',
};

// Mirrors _getConfiguredReactivityOrder() in
// meteor/packages/mongo/mongo_connection.js (same logic as server/main.js's
// resolveConfiguredObserverDriver). The first entry is what Meteor PREFERS;
// later entries are fall-throughs.
function resolveConfiguredFirst() {
  const setting = Meteor.settings?.packages?.mongo?.reactivity;
  if (Array.isArray(setting) && setting.length) return setting[0];
  if (typeof setting === 'string' && setting) return setting;
  const envOrder = process.env.METEOR_REACTIVITY_ORDER;
  if (envOrder) return envOrder.split(',')[0];
  return 'changeStreams'; // Meteor 3 DEFAULT_REACTIVITY_ORDER first entry
}

const observeCounts = new Map(); // `configured_to_actual` -> count
let totalObserves = 0;
let configuredFirst = null;

function record(actualName) {
  totalObserves++;
  const key = actualName === configuredFirst
    ? `${configuredFirst}_no_fallback`
    : `${configuredFirst}_to_${actualName}`;
  observeCounts.set(key, (observeCounts.get(key) || 0) + 1);
}

let patched = false;

export function initDriverFallbackTracker() {
  if (patched) return;
  const outputPath = process.env.DRIVER_FALLBACK_OUTPUT;
  if (!outputPath) return;
  patched = true;

  configuredFirst = resolveConfiguredFirst();

  const mongo = MongoInternals?.defaultRemoteCollectionDriver?.()?.mongo;
  if (!mongo || typeof mongo._observeChanges !== 'function') {
    process.stderr.write('[driver-fallback] mongo._observeChanges not reachable — metric will be empty\n');
    return;
  }

  // Wrap the INSTANCE, not the prototype. There's normally one default
  // mongo connection in a Meteor app; wrapping the instance avoids any
  // risk of double-wrap when other code touches the prototype.
  const orig = mongo._observeChanges.bind(mongo);
  mongo._observeChanges = async function (...args) {
    const handle = await orig(...args);
    try {
      const className = handle?._multiplexer?._observeDriver?.constructor?.name;
      const actualName = DRIVER_CLASS_TO_NAME[className] || `unknown:${className || 'undefined'}`;
      record(actualName);
    } catch {
      // Swallow — observers should never break because of measurement.
    }
    return handle;
  };

  installDumpOnShutdown(outputPath, () => {
    const fallbacks = {};
    let noFallback = 0;
    for (const [key, count] of observeCounts) {
      if (key.endsWith('_no_fallback')) noFallback += count;
      else fallbacks[key] = count;
    }
    return {
      total_cursors: totalObserves,
      no_fallback: noFallback,
      configured_first: configuredFirst,
      fallbacks,
    };
  }, 'driver-fallback');
}
