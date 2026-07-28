// Measures server-internal write-to-emit latency: time from
// Collection.insertAsync resolving to the moment Meteor's observer
// machinery emits the corresponding `added`/`changed` DDP message
// for EACH subscribed client. The metric most directly attributable
// to observer driver choice (changeStreams vs oplog vs polling) —
// a 100 ms propagation regression invisible in CPU/RAM shows up here.
//
// Surfaces as `metrics.live_update_propagation` (flat aggregate — not
// per-publication, not per-doc).
//
// Why a server-side Map keyed by docId, NOT __benchPushedAt in the doc:
//   1. In-doc field pollutes Mongo schema permanently.
//   2. Initial-batch contamination: when a new subscriber connects,
//      Meteor's observer sends sendAdded for ALL existing docs in the
//      cursor. With __benchPushedAt in those docs, we'd record their
//      ancient timestamps as "propagation" — they aren't.
// The Map + 10 s TTL solves both: only freshly-written docs are
// tracked, the map auto-prunes, and re-deliveries past the TTL are
// silently ignored.
//
// Two hooks:
//   - Mongo.Collection.prototype.insertAsync → record (docId, now)
//     post-await. One prototype patch covers every Collection instance,
//     current and future. No app code change required.
//   - Session.prototype.sendAdded + sendChanged → if docId in map,
//     record (now - mapValue) as a propagation sample. Grabbed lazily
//     off `Meteor.server.sessions` (any session — they all share the
//     prototype). Lazy because Meteor.onConnection fires BEFORE the
//     session is created on the server (conn._session is undefined at
//     that point — early review citation was wrong on this). We
//     re-attempt the patch on every insert until a session exists.
//
// Gated on PROPAGATION_TIMING_OUTPUT — without the env var, init is a
// no-op and Mongo writes are never wrapped (no per-insert overhead).
//
// Caveats (documented in package README):
//   - Only insert→emit propagation is measured; update-driven changed
//     events are observed but the update path isn't yet wrapped (no
//     map entry written), so changed events for non-tracked docs are
//     silent no-ops. Future task can wrap updateAsync.
//   - Polling driver propagation is dominated by poll interval (10 s
//     default), so the numbers will look very different per driver.

import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { installDumpOnShutdown } from './_dump-on-shutdown';

const MAX_SAMPLES = 100_000;
const ATTRIBUTION_TTL_MS = 10_000;
const CLEANUP_INTERVAL_MS = 5_000;

const insertTimestamps = new Map(); // docId(string) -> insertTime(ms)
const samples = []; // flat array of propagation latency ms

function recordInsert(id) {
  if (id == null) return;
  insertTimestamps.set(String(id), Date.now());
}

function recordPropagation(id) {
  if (id == null) return;
  if (samples.length >= MAX_SAMPLES) return;
  const key = String(id);
  const start = insertTimestamps.get(key);
  if (start == null) return;
  const elapsed = Date.now() - start;
  if (elapsed > ATTRIBUTION_TTL_MS) {
    // Stale — past the attribution window. Drop the entry and skip
    // (could be a late re-delivery to a new subscriber).
    insertTimestamps.delete(key);
    return;
  }
  samples.push(elapsed);
}

let patched = false;
let sessionProtoPatched = false;
let cleanupTimer = null;

// Grab Session.prototype off the first live session in Meteor.server.sessions
// and patch sendAdded / sendChanged. Returns true once patched; idempotent
// after that. Called lazily because Meteor doesn't expose the Session class
// and sessions don't exist until a DDP `connect` message arrives.
function tryPatchSessionProto() {
  if (sessionProtoPatched) return true;
  const sessions = Meteor.server?.sessions;
  if (!sessions) return false;
  // Meteor 3.x stores sessions in a Map; older versions used a plain object.
  // Iterate accordingly to grab any one — the prototype is shared.
  let firstSession = null;
  if (sessions instanceof Map) {
    firstSession = sessions.values().next().value;
  } else if (typeof sessions === 'object') {
    for (const k of Object.keys(sessions)) {
      firstSession = sessions[k];
      if (firstSession) break;
    }
  }
  if (!firstSession) return false;

  const proto = Object.getPrototypeOf(firstSession);
  if (typeof proto?.sendAdded !== 'function' || typeof proto?.sendChanged !== 'function') {
    return false;
  }
  const origSendAdded = proto.sendAdded;
  proto.sendAdded = function (collection, id, fields) {
    recordPropagation(id);
    return origSendAdded.call(this, collection, id, fields);
  };
  const origSendChanged = proto.sendChanged;
  proto.sendChanged = function (collection, id, fields) {
    recordPropagation(id);
    return origSendChanged.call(this, collection, id, fields);
  };
  sessionProtoPatched = true;
  return true;
}

export function initPropagationTiming() {
  if (patched) return;
  const outputPath = process.env.PROPAGATION_TIMING_OUTPUT;
  if (!outputPath) return;
  patched = true;

  // Wrap Mongo.Collection.prototype.insertAsync — captures every
  // insert into any Collection instance. Lazy-tries to grab Session
  // prototype on every insert, in case it wasn't grabbed at connect.
  const protoInsert = Mongo.Collection.prototype.insertAsync;
  Mongo.Collection.prototype.insertAsync = async function (...args) {
    const id = await protoInsert.apply(this, args);
    if (!sessionProtoPatched) tryPatchSessionProto();
    recordInsert(id);
    return id;
  };

  // Defer one event-loop tick so Meteor has a chance to create the
  // Session object before we look it up. Without this defer the
  // session map is still empty (the `connect` message hasn't been
  // processed yet). setImmediate is enough in practice.
  Meteor.onConnection(() => {
    if (sessionProtoPatched) return;
    setImmediate(() => tryPatchSessionProto());
  });

  // Periodic prune so long benchmarks don't grow the timestamps map
  // unbounded. unref() so the timer doesn't prevent process exit.
  cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - ATTRIBUTION_TTL_MS;
    for (const [key, ts] of insertTimestamps) {
      if (ts < cutoff) insertTimestamps.delete(key);
    }
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();

  installDumpOnShutdown(outputPath, () => samples, 'propagation-timing');
}
