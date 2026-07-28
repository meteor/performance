// Shared shutdown-dump pattern for every monitor in this package.
// Each monitor accumulates samples in-memory and needs to flush them
// to a file before the process exits. Two write paths, used together:
//
//   1. Periodic snapshot every SNAPSHOT_INTERVAL_MS — overwrites the
//      output file with a current dump. This is the LOAD-BEARING path.
//      The meteor parent process does NOT reliably forward SIGTERM to
//      its node child (gc-monitor.cjs:88 calls this out explicitly),
//      so we cannot count on signal handlers to fire before kill.
//      The last snapshot wins: lose at most SNAPSHOT_INTERVAL_MS of
//      samples between the final snapshot and the kill.
//
//   2. SIGTERM / SIGINT / beforeExit handlers — best-effort one-shot
//      write that captures samples between the last periodic snapshot
//      and the moment the signal lands. Often doesn't fire (meteor
//      kills child fast), but harmless when it does.
//
// `getDump` is called at write time so the caller can keep mutating
// its samples Map up to the last moment. `label` namespaces the
// stderr error message if the write fails — read it in the meteor
// log to identify which monitor lost data.

import fs from 'node:fs';

const SNAPSHOT_INTERVAL_MS = 5000;

export function installDumpOnShutdown(outputPath, getDump, label) {
  if (!outputPath) return;

  function write(reason) {
    try {
      fs.writeFileSync(outputPath, JSON.stringify(getDump()));
    } catch (err) {
      process.stderr.write(`[${label}] dump (${reason}) failed: ${err.message}\n`);
    }
  }

  // Periodic snapshot — load-bearing. unref so the timer doesn't keep
  // the event loop alive past natural exit.
  setInterval(() => write('snapshot'), SNAPSHOT_INTERVAL_MS).unref();

  // Signal-driven dump — fires once if the signal does land, captures
  // any samples between the last snapshot and the kill.
  const dumpOnce = (() => {
    let dumped = false;
    return () => {
      if (dumped) return;
      dumped = true;
      write('signal');
    };
  })();
  process.on('SIGTERM', dumpOnce);
  process.on('SIGINT', dumpOnce);
  process.on('beforeExit', dumpOnce);
}
