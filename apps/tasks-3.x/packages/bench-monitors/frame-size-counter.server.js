// Measures the BYTE SIZE of every DDP message in each direction, surfaced
// as `metrics.ddp_frame_size` (in/out size percentiles + per-type byte
// sums). Complementary to task 07's `ddp_messages`, which COUNTS messages:
// two configs sending the same number of messages can move very different
// byte volumes (e.g. partial-doc vs full-doc replacements, or sockjs text
// framing vs uws). This metric is where that shows up.
//
// Byte counting (REVISIONS.md task 08): the hooks see the STRUCTURED msg
// object PRE-serialization, so there's no socket frame to measure yet. The
// canonical wire size is the serialized DDP JSON — we compute
// `Buffer.byteLength(JSON.stringify(msg), 'utf8')`. This is the
// PRE-compression byte count (task 09 handles post-compression separately
// via socket.bytesRead/bytesWritten).
//
// Two hook points, identical to ddp-message-counter.server.js (the sibling
// monitor — pattern deliberately RE-IMPLEMENTED here, not cross-imported,
// so the monitors stay independent; a shared helper can be extracted once
// 3+ monitors need it):
//   - OUTGOING: Session.prototype.send(msg), grabbed lazily off a live
//     session in Meteor.server.sessions (Meteor.onConnection fires before
//     the Session exists, so conn._session is undefined there).
//   - INCOMING: Meteor.onMessage((msg, session)) — the official parsed-
//     incoming-DDP hook.
//
// Gated entirely on DDP_FRAME_SIZE_OUTPUT — without the env var the init is
// a no-op (no send wrap, no onMessage hook, zero per-message overhead).
//
// CC-8 high-volume pattern: like ddp_messages this can fire at 600+
// msgs/sec, so we accumulate in memory and flush via installDumpOnShutdown
// (NOT stderr extraction). The dump is RAW size arrays + per-type byte
// sums; the harness-side aggregator (runner/frame-size-aggregator.js)
// computes percentiles.
//
// MAX_SAMPLES caps each direction's size array (bounds memory on pathological
// >1M-message runs, per the spec's sampling note). The per-type byte SUMS
// keep accumulating past the cap (they don't need the array), so total-byte
// accounting stays complete even when the percentile sample is capped.

import { Meteor } from 'meteor/meteor';
import { installDumpOnShutdown } from './_dump-on-shutdown';

const MAX_SAMPLES = 200_000;

const inSizes = [];  // byte sizes of incoming messages (client → server)
const outSizes = []; // byte sizes of outgoing messages (server → client)
const byTypeInSum = new Map();  // msgType -> summed bytes in
const byTypeOutSum = new Map(); // msgType -> summed bytes out

function sizeOf(msg) {
  // JSON.stringify can throw on circular refs; DDP messages are plain
  // serializable objects, but guard anyway so a weird msg never crashes
  // the app's hot path. null serializes to "null" (4 bytes) — treat a
  // failed/empty serialization as 0 so it doesn't skew the distribution.
  try {
    const json = JSON.stringify(msg);
    if (!json) return 0;
    return Buffer.byteLength(json, 'utf8');
  } catch {
    return 0;
  }
}

function recordIncoming(msg) {
  const bytes = sizeOf(msg);
  if (inSizes.length < MAX_SAMPLES) inSizes.push(bytes);
  const type = msg?.msg;
  if (typeof type === 'string') byTypeInSum.set(type, (byTypeInSum.get(type) || 0) + bytes);
}

function recordOutgoing(msg) {
  const bytes = sizeOf(msg);
  if (outSizes.length < MAX_SAMPLES) outSizes.push(bytes);
  const type = msg?.msg;
  if (typeof type === 'string') byTypeOutSum.set(type, (byTypeOutSum.get(type) || 0) + bytes);
}

let patched = false;
let sessionProtoPatched = false;

// Grab Session.prototype off the first live session in Meteor.server.sessions
// and patch `send` to size outgoing messages. Idempotent; called lazily
// because Meteor doesn't export the Session class and sessions don't exist
// until a DDP `connect` has been processed.
function tryPatchSessionProto() {
  if (sessionProtoPatched) return true;
  const sessions = Meteor.server?.sessions;
  if (!sessions) return false;
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
    recordOutgoing(msg);
    return origSend.call(this, msg);
  };
  sessionProtoPatched = true;
  return true;
}

export function initFrameSizeCounter() {
  if (patched) return;
  const outputPath = process.env.DDP_FRAME_SIZE_OUTPUT;
  if (!outputPath) return;
  patched = true;

  Meteor.onMessage((msg) => {
    if (!sessionProtoPatched) tryPatchSessionProto();
    recordIncoming(msg);
  });

  Meteor.onConnection(() => {
    if (sessionProtoPatched) return;
    setImmediate(() => tryPatchSessionProto());
  });

  installDumpOnShutdown(outputPath, () => ({
    in_sizes: inSizes,
    out_sizes: outSizes,
    by_type_in_sum: Object.fromEntries(byTypeInSum),
    by_type_out_sum: Object.fromEntries(byTypeOutSum),
  }), 'frame-size-counter');
}
