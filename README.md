
## Motivation

This repository is the base to measure performance between Meteor 2 and Meteor 3. It serves as a comparison point for various functionalities and helps catch any performance regressions.

## What

This repository includes:

- Meteor applications for Meteor 2 and 3 to test performance, located in the `./apps` folder.
- Meteor packages for shared and isomorphic code, found in the `./packages` folder.
- Playwright tests to perform actions against the apps, found in `./tests`.
- Artillery configurations for stress testing your server, found in `./artillery`.
- Scripts to monitor performance and log results, found in `./scripts`.
- Logs from local monitoring runs, found in `./logs`.
- Benchmarks from official monitoring runs, found in `./benchmarks`.

## Requirements

- Unix System
- Node 20.x version

## How

To run a stress test on your machine:

```shell
npm install
./scripts/monitor.sh <app> <artillery-script> <log-context>
```

- `<app>`: The app folder name within `./apps` to stress test.
- `<artillery-script>`: The artillery configuration within `./artillery`.
- `<log-context>`: A name to prefix the logs generated within `./logs`.

The process will take some time, and the logs are updated live at `./logs`.

Your machine might struggle with the default artillery configuration, but it should still reveal performance differences between the tests. Adjust the configuration as needed by learning from [artillery.io options](https://www.artillery.io/docs).

## Benchmarks

### Meteor 2 vs 3

Meteor 3 is in average **~28% faster**, uses **~10% less CPU** and  **~16% less of RAM** in a **reactive scenario**.

Non-reactive scenario will follow.

More details on this benchmark can be found at [`./benchmarks/meteor2-vs-3`](./benchmarks/meteor2-vs-3)
