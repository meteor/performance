// Counts every DDP message the server sends and receives, bucketed by
// message type (connect/connected/sub/ready/unsub/nosub/method/result/
// updated/added/changed/removed/ping/pong/...). Surfaces as
// `metrics.ddp_messages` — total in/out, per-second rates, and a
// per-type breakdown.
//
// Message volume is a near-direct proxy for how "chatty" a pub/sub
// design is: two configs with identical CPU can have wildly different
// message rates, and the higher rate burns more network + serialization
// on both ends. Comparing oplog vs changeStreams for the same workload
// should show similar rates (same underlying data flow); a divergence
// flags one driver sending redundant deltas.
//
// Two hook points (per REVISIONS.md task 07 — the spec's
// `Meteor.server._stream_server` interception is wrong: that field does
// not exist, the real one is `stream_server` without the underscore, and
// it sits below the layer where messages are already parsed):
//
//   - OUTGOING: Session.prototype.send(msg). Fires once per DDP message
//     the server hands to a client. `msg` is the structured object
//     pre-serialization, so `msg.msg` is the type string — no frame
//     parsing. Session isn't exported, so we grab the prototype lazily
//     off a live session (see below).
//   - INCOMING: Meteor.onMessage((msg, session)). The official,
//     documented hook for parsed incoming DDP messages; fires for every
//     one. Also gives a structured `msg`.
//
// Why the lazy Session-prototype grab (not conn._session): Meteor 3's
// `Meteor.onConnection` fires BEFORE the server creates the Session
// object — `conn._session` is undefined at that point. The Session lives
// in `Meteor.server.sessions` (keyed by id), created after the DDP
// `connect` message arrives. We walk that map to grab any session (all
// share one prototype), patch `send` once, and flag it done. We retry
// the patch from two places so we never miss the window: deferred a tick
// inside onConnection, and again inside the onMessage callback (covers
// fast-arriving incoming traffic). Idempotent via sessionProtoPatched.
// This mirrors the lazy-lookup pattern in propagation-timing.server.js
// (deliberately re-implemented, not cross-imported — these monitors are
// independent; a future task can extract a shared helper once 3+ exist).
//
// Gated entirely on DDP_MESSAGE_OUTPUT — without the env var the init is
// a no-op (no send wrap, no onMessage hook, zero per-message overhead).
//
// CC-8 high-volume pattern: ddp_messages can fire at 600+ msgs/sec, so
// we accumulate in-memory counters and flush via the SIGTERM dump-file
// helper (NOT stderr extraction, which risks loss and slows the hot
// path). The dump is RAW counts; the harness-side aggregator
// (runner/message-rate-aggregator.js) computes the per-second rates.

import { Meteor } from 'meteor/meteor';
import { installDumpOnShutdown } from './_dump-on-shutdown';

const byIn = new Map(); // msgType -> count (client → server)
const byOut = new Map(); // msgType -> count (server → client)
let totalIn = 0;
let totalOut = 0;
let startTime = 0;

function countIncoming(msg) {
  const type = msg?.msg;
  if (typeof type !== 'string') return;
  byIn.set(type, (byIn.get(type) || 0) + 1);
  totalIn++;
}

function countOutgoing(msg) {
  const type = msg?.msg;
  if (typeof type !== 'string') return;
  byOut.set(type, (byOut.get(type) || 0) + 1);
  totalOut++;
}

let patched = false;
let sessionProtoPatched = false;

// Grab Session.prototype off the first live session in
// Meteor.server.sessions and patch `send` to count outgoing messages.
// Returns true once patched; idempotent after that. Called lazily —
// Meteor doesn't expose the Session class and sessions don't exist
// until a DDP `connect` message has been processed.
function tryPatchSessionProto() {
  if (sessionProtoPatched) return true;
  const sessions = Meteor.server?.sessions;
  if (!sessions) return false;
  // Meteor 3.x stores sessions in a Map; older versions used a plain
  // object. Grab any one — the prototype is shared across all sessions.
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
  if (typeof proto?.send !== 'function') return false;

  const origSend = proto.send;
  proto.send = function (msg) {
    countOutgoing(msg);
    return origSend.call(this, msg);
  };
  sessionProtoPatched = true;
  return true;
}

export function initDdpMessageCounter() {
  if (patched) return;
  const outputPath = process.env.DDP_MESSAGE_OUTPUT;
  if (!outputPath) return;
  patched = true;
  startTime = Date.now();

  // Incoming: official hook, structured msg. Also a convenient place to
  // retry the outgoing-send patch in case a session sent a message
  // before our onConnection defer fired.
  Meteor.onMessage((msg) => {
    if (!sessionProtoPatched) tryPatchSessionProto();
    countIncoming(msg);
  });

  // Defer one tick so Meteor has created the Session before we look it
  // up (the session map is still empty synchronously inside
  // onConnection — the `connect` message hasn't been processed yet).
  Meteor.onConnection(() => {
    if (sessionProtoPatched) return;
    setImmediate(() => tryPatchSessionProto());
  });

  installDumpOnShutdown(outputPath, () => ({
    startTime,
    endTime: Date.now(),
    by_in: Object.fromEntries(byIn),
    by_out: Object.fromEntries(byOut),
  }), 'ddp-message-counter');
}
