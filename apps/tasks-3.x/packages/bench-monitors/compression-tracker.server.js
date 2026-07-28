// Measures DDP-over-the-wire compression by sampling the underlying TCP
// socket's `bytesRead` / `bytesWritten` per connection at open and at
// close (or at SIGTERM for live connections). Combined with the
// uncompressed totals frame-size-counter.server.js captures from the
// same JSON.stringify(msg) bytes, the harness aggregator produces
// `metrics.ddp_compression` with ratio + savings_pct per direction.
//
// "Coarse" by design (task 09 spec, post-REVISIONS): we don't get
// per-message compression info from the `ws` library, so we measure
// totals at the TCP-socket boundary. The numbers include WS framing
// overhead beyond the DDP payload itself — small per frame (2-14 bytes)
// but inflates the ratio toward 1.0 for very chatty workloads with tiny
// messages. Document on the dashboard panel.
//
// Gated entirely on DDP_COMPRESSION_OUTPUT — no env, no hook, zero
// overhead. Standard for every bench-monitor in this package.
//
// Hook strategy (deliberately gentle on Meteor internals):
//   1. Meteor.onConnection(conn) fires on every new client. We register
//      conn.onClose to record final socket bytes when the client drops.
//      The TCP socket itself is reached via several candidate paths
//      (see findRawSocket below) — Meteor doesn't expose it; we fall
//      back gracefully if our paths don't match this Meteor version,
//      logging once to stderr.
//   2. At baseline grab we snapshot bytesRead/bytesWritten. On close
//      (or SIGTERM, see installDumpOnShutdown closure) we compute the
//      delta. The aggregate is per-direction sum of compressed bytes
//      moved over the run.
//
// MAX_SOCKETS caps the tracked-connection Map to bound memory in
// pathological VU-flood scenarios (100k connections × 24 bytes ≈ 2.4
// MB nominal; cap protects against unbounded growth).

import { Meteor } from 'meteor/meteor';
import { installDumpOnShutdown } from './_dump-on-shutdown';

const MAX_SOCKETS = 100_000;

const sockets = new Map(); // connId -> { socket?, startRead, startWritten, endRead?, endWritten? }
let closedRead = 0;   // accumulated compressed bytes from sockets that already closed
let closedWritten = 0;
let socketResolutionWarned = false;

// Meteor doesn't expose the underlying TCP socket on the connection
// object. Walk the candidate paths in order; first one that yields a
// real socket with numeric bytesRead/bytesWritten wins. If none match
// (different Meteor minor / different transport), we log once and the
// metric ends up empty for that connection — handled by the absence
// convention upstream.
function findRawSocket(conn) {
  const candidates = [
    () => conn?._session?.socket?._socket,
    () => conn?._session?.socket,
    () => conn?._session?._socket?._socket,
    () => conn?._session?._socket,
    () => conn?._socket?._socket,
    () => conn?._socket,
  ];
  for (const get of candidates) {
    try {
      const s = get();
      if (s && typeof s.bytesRead === 'number' && typeof s.bytesWritten === 'number') return s;
    } catch {}
  }
  return null;
}

let patched = false;

export function initCompressionTracker() {
  if (patched) return;
  const outputPath = process.env.DDP_COMPRESSION_OUTPUT;
  if (!outputPath) return;
  patched = true;

  Meteor.onConnection((conn) => {
    if (sockets.size >= MAX_SOCKETS) return;

    // Defer one event-loop turn so the session/socket exist
    // (conn._session is undefined inside onConnection itself, same gotcha
    // as propagation-timing.server.js and the message counter).
    setImmediate(() => {
      const socket = findRawSocket(conn);
      if (!socket) {
        if (!socketResolutionWarned) {
          process.stderr.write('[compression-tracker] could not resolve underlying TCP socket — metric will be empty\n');
          socketResolutionWarned = true;
        }
        return;
      }
      const id = conn.id;
      sockets.set(id, {
        socket,
        startRead: socket.bytesRead,
        startWritten: socket.bytesWritten,
      });
      conn.onClose(() => {
        const entry = sockets.get(id);
        if (!entry) return;
        // Capture final byte counts BEFORE the socket is torn down. After
        // close the socket can still report stale numbers (libuv keeps the
        // counters until GC), but read them now while we know they're live.
        const finalRead = socket.bytesRead;
        const finalWritten = socket.bytesWritten;
        closedRead += Math.max(0, finalRead - entry.startRead);
        closedWritten += Math.max(0, finalWritten - entry.startWritten);
        sockets.delete(id);
      });
    });
  });

  installDumpOnShutdown(outputPath, () => {
    // Account for connections still alive at SIGTERM: their delta from
    // baseline to now contributes too. We don't mutate the Map — the
    // periodic snapshot may fire multiple times before final shutdown,
    // and each one should report a self-consistent total.
    let liveRead = 0;
    let liveWritten = 0;
    for (const entry of sockets.values()) {
      try {
        liveRead += Math.max(0, entry.socket.bytesRead - entry.startRead);
        liveWritten += Math.max(0, entry.socket.bytesWritten - entry.startWritten);
      } catch {}
    }
    return {
      compressed_bytes_in: closedRead + liveRead,
      compressed_bytes_out: closedWritten + liveWritten,
      connections_tracked: sockets.size + (closedRead + closedWritten > 0 ? 1 : 0), // crude liveness
    };
  }, 'compression-tracker');
}
