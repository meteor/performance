// Parses `[runtime-info] key=value` lines out of a byte stream and
// accumulates the key/value pairs.
//
// Used by runner/meteor-process.js to capture the runtime dimensions
// (observer_driver, transport) that apps/tasks-3.x/server/main.js prints
// on startup. Pure: no I/O, no async, no globals.
//
// Buffers partial chunks so a line straddling two `data` events still
// parses. Later values for the same key win (every Meteor restart in a
// loop re-emits the same lines).

const LINE_RE = /^\[runtime-info\] (\w+)=(.+)$/;

export function createRuntimeInfoExtractor() {
  let buffer = '';
  const captured = {};

  return {
    feed(chunk) {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const m = LINE_RE.exec(line);
        if (m) captured[m[1]] = m[2];
      }
    },
    get: () => ({ ...captured }),
  };
}
