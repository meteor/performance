import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { tryMonitorExtras, initializeTaskCollection, registerTaskApi } from 'meteor/tasks-common';
import { initMethodTiming, initSubTiming, initPropagationTiming, initObserverPoolSampler, initDdpMessageCounter, initFrameSizeCounter, initCompressionTracker, initDriverFallbackTracker } from 'meteor/bench-monitors';

// Emit machine-parseable lines on startup. The benchmark harness greps
// these from stderr and surfaces them under `runtime.*` in the result
// JSON so the dashboard can compare across the (observer driver × DDP
// transport) matrix without guessing what each run was configured for.
//
// Three keys are logged:
//   transport               — chosen via Meteor's real resolution order
//   observer_driver         — what the configured order asks for (first preference)
//   observer_driver_actual  — what Meteor actually instantiated for a real
//                             observe() — ground truth, not just intent
//
// Why both observer_driver and observer_driver_actual: the configured
// value can disagree with what Meteor uses if the preferred driver
// isn't available at runtime (e.g. asked for oplog but MONGO_OPLOG_URL
// isn't set, so Meteor falls through to changeStreams or polling).
// The `_actual` line is the one a benchmark reader should trust.

// Mirrors resolveTransportName() in
// meteor/packages/ddp-server/transports/index.js. Priority MUST match
// Meteor's, otherwise the logged value diverges from the real choice.
function resolveConfiguredTransport() {
  const settings = Meteor.settings?.packages?.['ddp-server'];
  if (settings?.transport) return settings.transport;
  if (process.env.DDP_TRANSPORT) return process.env.DDP_TRANSPORT;
  if (process.env.DISABLE_SOCKJS) return 'uws';
  return 'sockjs';
}

// Mirrors _getConfiguredReactivityOrder() in
// meteor/packages/mongo/mongo_connection.js. The first entry is what
// Meteor prefers; later entries fall through if unavailable.
function resolveConfiguredObserverDriver() {
  const setting = Meteor.settings?.packages?.mongo?.reactivity;
  if (Array.isArray(setting) && setting.length) return setting[0];
  if (typeof setting === 'string' && setting) return setting;
  const envOrder = process.env.METEOR_REACTIVITY_ORDER;
  if (envOrder) return envOrder.split(',')[0];
  return 'changeStreams'; // Meteor 3 DEFAULT_REACTIVITY_ORDER first entry
}

// Probe a throwaway collection: observe it once so Meteor instantiates
// the driver, read the driver instance from the multiplexer, stop the
// observer, drop the collection. The driver instance is recorded on
// `multiplexer._observeDriver` by mongo_connection.js:1213 (marked
// "set for use in tests" — brittle but the only ground-truth path).
const DRIVER_CLASS_TO_NAME = {
  ChangeStreamObserveDriver: 'changeStreams',
  OplogObserveDriver: 'oplog',
  PollingObserveDriver: 'polling',
};

async function probeActualObserverDriver() {
  const collName = `__runtime_info_probe_${process.pid}_${Date.now()}`;
  let handle;
  try {
    const probe = new Mongo.Collection(collName);
    handle = await probe.find().observeChangesAsync({ added: () => {} });
    const className = handle._multiplexer?._observeDriver?.constructor?.name;
    return DRIVER_CLASS_TO_NAME[className] || `unknown_class:${className || 'undefined'}`;
  } catch (err) {
    return `probe_failed:${String(err.message).replace(/[\r\n]+/g, ' ').slice(0, 100)}`;
  } finally {
    try { handle?.stop?.(); } catch {}
    try {
      // Drop the throwaway collection so we don't leave junk in the DB
      // across many benchmark runs.
      await new Mongo.Collection(collName).rawCollection().drop().catch(() => {});
    } catch {}
  }
}

async function logRuntimeInfo() {
  const transport = resolveConfiguredTransport();
  const observerConfigured = resolveConfiguredObserverDriver();
  const observerActual = await probeActualObserverDriver();
  process.stderr.write(`[runtime-info] transport=${transport}\n`);
  process.stderr.write(`[runtime-info] observer_driver=${observerConfigured}\n`);
  process.stderr.write(`[runtime-info] observer_driver_actual=${observerActual}\n`);
}

Meteor.startup(async () => {
  await logRuntimeInfo();
  // bench-monitors inits must run BEFORE any user code that registers
  // Meteor APIs or writes to collections:
  //   - initMethodTiming wraps Meteor.methods
  //   - initSubTiming wraps Meteor.publish
  //   - initPropagationTiming wraps Mongo.Collection.prototype.insertAsync
  //     (and registers onConnection for Session prototype patching)
  //   - initDdpMessageCounter patches Session.prototype.send + registers
  //     Meteor.onMessage (monkey-patches a prototype + a registration
  //     hook, so order isn't strictly load-bearing — kept here for
  //     consistency with the other Session-prototype monitors).
  //   - initFrameSizeCounter patches Session.prototype.send + Meteor.onMessage
  //     too (same hook points as the message counter, measuring byte size
  //     instead of count — independent wraps, also order-insensitive).
  // The wraps only apply to subsequent registrations / instances.
  // initObserverPoolSampler only READS _observeMultiplexers on an interval
  // (no wrap), so its order is not load-bearing — kept here for consistency.
  initMethodTiming();
  initSubTiming();
  initPropagationTiming();
  initDdpMessageCounter();
  initFrameSizeCounter();
  initCompressionTracker();
  initDriverFallbackTracker();
  initObserverPoolSampler();
  tryMonitorExtras();
  initializeTaskCollection();
  await registerTaskApi();
});
