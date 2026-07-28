# bench-monitors

In-app Meteor package that hosts every monkey-patch/hook the benchmark
harness needs to read Meteor's internals. Each monitor patches a Meteor
API (`Meteor.methods`, `Meteor.publish`, `Session.prototype.*`, observe
multiplexers, etc.) to record samples in memory, then dumps to a file
when the process shuts down. The harness reads the file in
[runner/collectors.js](../../../../runner/collectors.js) and surfaces
the aggregated numbers under `metrics.<key>` in the result JSON.

**Activation is env-gated**: each monitor only writes its dump file when
the matching `<COLLECTOR>_OUTPUT` env var is set by the harness. Without
the env var the hook is a no-op — the package is transparent in normal
`meteor run` / `meteor dev` use.

## Why separate from tasks-common

[tasks-common](../tasks-common) holds the app's domain: `TasksCollection`,
methods, pub, React UI. bench-monitors holds harness instrumentation.
Splitting them keeps the app's business logic readable and lets the
monitoring surface grow (future: observer pool, DDP middleware, oplog
backlog, driver fallback) without polluting domain files.

## Current monitors

| File | Init fn | Env var | Metric key |
|---|---|---|---|
| [method-timing.server.js](method-timing.server.js) | `initMethodTiming` | `METHOD_TIMING_OUTPUT` | `ddp_methods` |
| [sub-timing.server.js](sub-timing.server.js) | `initSubTiming` | `SUB_TIMING_OUTPUT` | `ddp_subscriptions` |
| [propagation-timing.server.js](propagation-timing.server.js) | `initPropagationTiming` | `PROPAGATION_TIMING_OUTPUT` | `live_update_propagation` |
| [observer-pool-sampler.server.js](observer-pool-sampler.server.js) | `initObserverPoolSampler` | `OBSERVER_POOL_OUTPUT` | `observer_pool` |
| [ddp-message-counter.server.js](ddp-message-counter.server.js) | `initDdpMessageCounter` | `DDP_MESSAGE_OUTPUT` | `ddp_messages` |
| [frame-size-counter.server.js](frame-size-counter.server.js) | `initFrameSizeCounter` | `DDP_FRAME_SIZE_OUTPUT` | `ddp_frame_size` |
| [compression-tracker.server.js](compression-tracker.server.js) | `initCompressionTracker` | `DDP_COMPRESSION_OUTPUT` | `ddp_compression` (combines with frame-size dump) |
| [driver-fallback-tracker.server.js](driver-fallback-tracker.server.js) | `initDriverFallbackTracker` | `DRIVER_FALLBACK_OUTPUT` | `driver_fallbacks` |

Each init is re-exported from
[bench-monitors.server.js](bench-monitors.server.js) and called from
[apps/tasks-3.x/server/main.js](../../server/main.js) inside
`Meteor.startup` **before** any user code that registers Meteor APIs
or writes to collections. The wrap only applies to subsequent
registrations / instances, so order matters:

```js
Meteor.startup(async () => {
  initMethodTiming();         // patches Meteor.methods
  initSubTiming();            // patches Meteor.publish
  initPropagationTiming();    // patches Mongo.Collection.prototype.insertAsync
  // ...
  await registerTaskApi();    // wrapped by the above
});
```

### Propagation monitor: known limitations

- Only INSERT → emit latency is measured. `updateAsync` isn't wrapped
  yet, so `sendChanged` events for non-tracked docs are silent no-ops.
- A 10 s attribution TTL bounds the timestamps map. Re-deliveries past
  the window are silently dropped, which protects the metric from
  initial-batch contamination (new subs receiving stale existing docs)
  at the cost of underreporting in benchmarks where subs join >10 s
  after a write.
- Polling driver propagation is dominated by poll interval (10 s
  default in Meteor), so expect very different numbers across drivers.

## How a monitor works (pattern)

1. Gate the WHOLE init on `process.env.<COLLECTOR>_OUTPUT`. Without the
   env var, the monitor is a complete no-op — no wrap installed, zero
   per-call overhead. The harness sets the env in benchmark runs only.
2. When the env IS set, patch a Meteor API (registration like
   `Meteor.methods`/`Meteor.publish`, or prototype like
   `Mongo.Collection.prototype.insertAsync` / `Session.prototype.sendAdded`)
   to install a wrapper around every handler/method.
3. Wrapper records `performance.now()` / `Date.now()` at entry and
   pushes a sample to an in-memory store (`Map<name, number[]>` for
   grouped metrics, flat `number[]` for aggregate metrics) on the
   relevant DDP lifecycle event.
4. Cap samples (currently 100k) so a pathological workload can't OOM
   the app.
5. Call [installDumpOnShutdown](_dump-on-shutdown.js) with the output
   path + a closure returning the dump shape + a label. The helper
   writes the file two ways:
   - **Periodic snapshot every 5 s** (load-bearing — the meteor parent
     doesn't reliably forward SIGTERM to its node child, so signal
     handlers alone lose data; the last snapshot before kill survives).
   - **SIGTERM / SIGINT / beforeExit handlers** (best-effort — captures
     samples between the last snapshot and the kill if the signal does
     land).

[method-timing.server.js](method-timing.server.js) is the canonical
reference for the grouped-by-name shape.
[propagation-timing.server.js](propagation-timing.server.js) is the
canonical reference for the flat-aggregate shape (and prototype-level
patching across Meteor classes that aren't exported).

## How to add a new monitor

Mechanical steps — each task in `.claude/metrics-tasks/` follows this:

1. **New file in this package**: `apps/tasks-3.x/packages/bench-monitors/<thing>.server.js`
   - Export `init<Thing>()`.
   - Patch the relevant Meteor API.
   - Use the SIGTERM dump pattern above, gated on `<THING>_OUTPUT`.

2. **Re-export from
   [bench-monitors.server.js](bench-monitors.server.js)**:
   ```js
   import { initThing } from './thing.server';
   export { initMethodTiming, initSubTiming, initThing };
   ```

3. **Call from
   [apps/tasks-3.x/server/main.js](../../server/main.js)**:
   ```js
   import { ..., initThing } from 'meteor/bench-monitors';
   Meteor.startup(async () => {
     // ...
     initThing();
     await registerTaskApi();
   });
   ```

4. **Wire harness side**
   ([runner/collectors.js](../../../../runner/collectors.js) +
   [runner/meteor-process.js](../../../../runner/meteor-process.js)):
   - `prepareThingOutput(tag)` — returns a `results/thing-<tag>-<ts>.json` path.
   - Pass `thingPath` through `startMeteorApp` (sets `THING_OUTPUT` env var)
     and through `startCollectors`/`stopCollectors`.
   - `aggregateThing(samples)` — turns the raw `Map` dump into the
     `metrics.<key>` shape. Returns `null` when no samples (absence
     convention — caller omits the key entirely).
   - In `stopCollectors`, read the dump file, call the aggregator, push
     the result, `unlinkSync` the file.

5. **Wire drivers** ([drivers/artillery.js](../../../../drivers/artillery.js) +
   [drivers/script.js](../../../../drivers/script.js)): call
   `prepareThingOutput` and pass `thingPath` through `startMeteorApp` +
   `startCollectors`.

6. **Tests**:
   - `tests/unit/<thing>-percentiles.test.js` for the aggregator
     (mirror [tests/unit/method-timing-percentiles.test.js](../../../../tests/unit/method-timing-percentiles.test.js)).
   - One-line extension to
     [tests/unit/metric-keys-contract.test.js](../../../../tests/unit/metric-keys-contract.test.js) `ALLOWED_METRIC_KEYS`.

## Conventions

All bench-monitors output follows the cross-cutting rules in
`.claude/metrics-tasks/README.md`:

- **Percentile suffix is BARE** (`p50`, `p95`, `p99`) — never `p50_ms`.
  Matches the shipped `event_loop_delay` contract. Unit is implicit ms.
- **Non-percentile latency scalars** keep `_ms` (`avg_ms`, `max_ms`).
- **Absence**: omit the key when there are no samples; emit `0` when the
  collector ran and the count is genuinely zero; `null` for ratios with
  undefined denominators.
- **Stable identifiers**: per-entity maps key by real names
  (`fetchTasks`, `insertTask`), never positional (`pub_0`).

## File layout

```
bench-monitors/
├── package.js                       Meteor package manifest
├── bench-monitors.server.js         server main: re-exports each init fn
├── _dump-on-shutdown.js             shared SIGTERM dump helper
├── method-timing.server.js          ddp_methods (task 01)
├── sub-timing.server.js             ddp_subscriptions (task 02)
├── propagation-timing.server.js     live_update_propagation (task 03)
├── observer-pool-sampler.server.js  observer_pool (task 05)
├── ddp-message-counter.server.js    ddp_messages (task 07)
├── frame-size-counter.server.js     ddp_frame_size (task 08)
└── README.md                        this file
```
