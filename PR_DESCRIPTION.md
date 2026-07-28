# Refactor: from ad-hoc benchmark scripts to a Meteor Benchmark Platform

> Branch: `redesign/v2-blaze-tailwind` → `main`
> 74 commits · 229 files changed · +26,628 / −38,033

## Summary

This PR rewrites the repository from a loose collection of benchmark scripts, Playwright tests and hand-captured `.log` files into a **structured, reproducible benchmark platform** for Meteor.

What used to be "run a script, eyeball a log, commit the output" is now a single CLI (`bench.js`) with a modular pipeline — **drivers → collectors → aggregators → reporters** — backed by a Meteor instrumentation package, a results dashboard, a unit-test suite, and CI workflows that run benchmarks on PRs, nightly, and across transport/observer matrices.

The net line count *drops* (−38k) because ~13k lines of stale benchmark logs and the entire Meteor 2.x app were removed, while the new harness, monitors, dashboard and tests were added.

---

## Why

The old setup (`main`) had real limitations:

- **Manual & non-reproducible** — benchmarks were run by hand and results pasted into `benchmarks/**/*.log`. No schema, no comparison tooling, no regression gate.
- **Stale artifacts** — thousands of lines of committed run logs that nobody could re-derive.
- **Two apps to maintain** — Meteor 2.x and 3.x, plus abandoned OTel / APM-agent experiments.
- **No CI signal** — nothing ran benchmarks automatically or flagged regressions.

The goal of this branch was to make benchmarking **a first-class, automatable workflow**: one command to run a scenario, structured JSON out, automatic regression detection against a baseline, and a dashboard to visualize trends across Meteor versions and transport/observer configurations.

---

## What changed

### 1. New CLI & harness architecture

A thin `bench.js` entry point dispatches to focused modules:

```
bench.js              # parse argv → dispatch → exit
├── cli/              # subcommand handlers: run, list, compare, push, baseline, bundle-delta
├── drivers/          # how a scenario executes: artillery, script, cold-start, bundle-size, build-profile
├── collectors/       # live process/DB sampling: cpu/ram, event-loop, gc, mongo ops/pool/wiredtiger/...
├── runner/           # orchestration + per-metric aggregators
├── reporters/        # json-reporter + regression-detector (markdown/json output)
├── lib/              # shared pure helpers (percentiles, ...)
└── meteor-source.js  # resolve pinned release vs local checkout
```

**Subcommands:**

| Command | Purpose |
|---|---|
| `node bench.js list` | List scenarios and apps |
| `node bench.js run --scenario X --app Y --tag Z` | Run a benchmark, write result JSON |
| `node bench.js compare --baseline A --target B` | Diff two results, detect regressions |
| `node bench.js push --result file.json` | Push a result to the dashboard |
| `node bench.js baseline --scenario X --run-id Y` | Pin a run as the scenario baseline |
| `node bench.js bundle-delta [--limit N]` | Bundle-size trend across saved runs |

### 2. `bench-monitors` Meteor package (server-side instrumentation)

A new in-app package (`apps/tasks-3.x/packages/bench-monitors/`) injects lightweight, opt-in server instrumentation that emits parseable metrics consumed by the harness:

- Method timing, subscription timing, live-update propagation latency
- DDP message counter, DDP frame size, DDP compression
- Observer-pool sampler, driver-fallback tracker
- Dump-on-shutdown hook so metrics survive process exit

### 3. Metric collectors & aggregators (tasks 01–24)

A broad set of metrics, each with a collector (sampling) + aggregator (summarizing) + unit tests + dashboard panel:

- **Process:** CPU/RAM, event-loop lag, GC pauses
- **Mongo:** ops rates, slow queries, index usage, connection pool, WiredTiger cache, change streams
- **DDP:** method/sub timing, message rate, frame size, compression
- **Meteor internals:** observer pool, driver fallbacks
- **Build:** `METEOR_PROFILE=1` build profile (hot nodes) + per-plugin compile time, bundle-size delta

### 4. Results dashboard (`apps/dashboard/`) — design v2

A new Meteor app to visualize runs, built on a **Tailwind design system (v2)**:

- **Design system** — swapped Bootstrap → **Tailwind**, with Geist / JetBrains Mono typography and shared theme tokens.
- **Rebuilt pages** — Runs overview, **Detail** (grouped metric sections + sticky section rail), **Compare** (regression scoreboard + side-by-side diff), **Scenario** view, and **Trends**.
- Runs are pushed over DDP and rendered with per-metric panels for every metric above; deployed to Galaxy at `meteor-benchmarks.us.galaxycloud.app`.

### 5. Runtime observability & configuration matrix

- The app logs `[runtime-info] observer_driver=…` / `transport=…` on startup; the harness captures these from stderr into each result's `runtime` field, so every pushed run is self-describing.
- Supports benchmarking **published releases** (`--meteor-version`) *or* a **local checkout** (`--meteor-checkout`), mutually exclusive.
- Enables explicit `{changeStreams, oplog} × {sockjs, uws}` comparison on the dashboard.

### 6. CI workflows

- `benchmark-pr.yml` — run benchmarks on PRs (with hardened `client_payload` handling)
- `benchmark-nightly.yml` — scheduled runs
- `benchmark-runtime-matrix.yml` — the 2×2 observer × transport matrix
- `benchmark-transport.yml` — sockjs vs uws

### 7. Test suite

~40 `node:test` unit-test files covering every aggregator, the regression detector (incl. zero-baseline / NaN / Infinity edge cases), CLI commands, the meteor-source resolver, runtime-info extraction, and a metric-keys contract test to keep collector output and the dashboard in sync.

### 8. Cleanup / removals

- Removed the **Meteor 2.x app** (`apps/tasks-2.x`) — focus is on Meteor 3.x.
- Removed **OTel** and the **APM-agent** experiments.
- Deleted ~13k lines of stale, hand-captured benchmark `.log` files under `benchmarks/`.
- Collapsed top-level `packages/` into the app; pruned obsolete files and tightened `.gitignore`.
- Converted the harness to **ESM** and bumped to **Node 24** (CI + Volta).

---

## Migration notes

- **Node 24 required** (was Node 20).
- The harness is now **ESM** (`"type": "module"`).
- The Meteor 2.x app is gone — all scenarios target `tasks-3.x`.
- Old `benchmarks/**/*.log` artifacts were intentionally removed; reproduce via `node bench.js run` instead.

## How to test

```bash
npm install
npm test                                  # unit suite
node bench.js list                        # sanity-check config
node bench.js run --scenario ddp-reactive-light --app tasks-3.x --tag smoke
```
