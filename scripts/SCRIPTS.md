# scripts/

Legacy operations scripts kept for ad-hoc local + Galaxy runs. None are
invoked by `bench.js`, `package.json`, or any GitHub workflow — the
modern path is `node bench.js run` (see `../README.md`). This file
inventories what's here so you can tell at a glance which scripts are
safe to use today and which need a small fix-up first.

## Top-level shell scripts

| Script | Purpose | Called by | Caveats |
|---|---|---|---|
| `monitor.sh` | Run an Artillery scenario against a local Meteor app, monitor CPU/RAM during the run, write a log under `logs/`. | Ad-hoc, manual. | **Broken as of commit 3.** References the `apm-agent` Meteor package (via `ENABLE_APM`), which was deleted in commit `c3f5c9e` together with the top-level `packages/` directory. To use, either re-add the package under `apps/tasks-3.x/packages/apm-agent/` or remove the `ENABLE_APM` branches from the script. |
| `monitor-remote.sh` | Run an Artillery scenario against a Galaxy-deployed app; restarts the Galaxy container first, pulls Monti-style CPU/RAM samples afterward. | Ad-hoc, manual; expects `.env.prod` (Galaxy API key, Mongo URLs). | Galaxy-only. Requires `GALAXY_API_KEY` and a configured Galaxy app. |
| `monitor-bundler.sh` | Profile Meteor's bundler against an app: build times per stage, optional bundle size, optional build-output retention. | Ad-hoc, manual. | **Superseded** by `node bench.js run --scenario bundle-size`, which uses native `fs.statSync` recursion instead of `du`/`rm -rf` shell-outs and writes the standard result-JSON shape. Starting with Meteor 3.2, `meteor profile` covers the per-stage timings the script reports. |
| `deploy.sh` | Deploy an app to its Galaxy hostname (`<app>-perf.meteorapp.com`). | Ad-hoc, manual. | Same `apm-agent` caveat as `monitor.sh` — references the deleted package via `ENABLE_APM`. Same fix applies. |

## `helpers/` (Node scripts called by the shell wrappers above)

| Helper | Purpose | Called by |
|---|---|---|
| `monitor-cpu-ram.js` | Sample CPU and RAM for a single PID via `pidusage`, summarize on SIGINT/SIGTERM. | `monitor.sh` (twice — once for the app PID, once for the Mongo PID). Superseded in the modern harness by `collectors/process-monitor.js`. |
| `monitor-remote-cpu-ram.js` | Pull CPU/RAM samples from a Galaxy container via the Galaxy GraphQL API. | `monitor-remote.sh` at the end of each run. |
| `print-bundle-size.js` | Fetch Meteor's bundle-visualizer stats endpoint, print parsed sizes. | `monitor-bundler.sh` when `METEOR_BUNDLE_SIZE` is set. |
| `print-meteor-config.js` | Print the resolved Meteor release file (`.meteor/release`) for a given app path. | `monitor-bundler.sh`. |
| `print-meteor-packages.js` | List an app's npm or atmosphere packages with versions. | `monitor-bundler.sh` (called twice — once for npm, once for atmosphere). |
| `get-meteor-entrypoint.js` | Read an app's `package.json` and print its client or server entrypoint path. | `monitor-bundler.sh` when `METEOR_CLIENT_ENTRYPOINT` / `METEOR_SERVER_ENTRYPOINT` are unset. |
