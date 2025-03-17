# Meteor bundler

## How

### Running locally

To run a Meteor profile of the bundling process of your app on your machine:

```shell
./scripts/monitor-bundler.sh <app> <log-context>
```

- `<app>`: The app folder name within `./apps` to profile, or the absolute path to any Meteor app.
- `<log-context>`: A name to prefix the logs generated within `./logs`.

You can analyze performance using a Meteor checkout. This helps measure the impact of changes and ensures performance stays consistent or improves.

```shell
METEOR_CHECKOUT_PATH=<path-to-meteor-checkout> ./scripts/monitor-bundler.sh <app> <log-context>
```

Set `METEOR_BUNDLE_SIZE=true` to gather bundle size data and assess changes in build size.

Use `METEOR_IDLE_TIMEOUT=<seconds>` to set a profiling timeout. The default (90s) is usually enough for each build step. If you get errors from early exits, adjust this value.

Use `METEOR_CLIENT_ENTRYPOINT=<path-to-file>` to set a custom client entrypoint, and
`METEOR_SERVER_ENTRYPOINT=<path-to-file>` to set a custom server entrypoint. By default,
it uses the server and client entrypoints specified in your package.json.

Use `METEOR_LOG_DIR=<path-to-directory>` to set a custom log directory.

> Starting with Meteor 3.2, this script is included in the CLI. If you're using this version, run `meteor profile` to get a performance report. The same environment variables apply.

## Benchmarks

### Meteor 2.16 vs 3.2

#### TODO
