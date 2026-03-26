# Meteor performance

## Motivation

This repository is the base to measure performance between Meteor 2 and Meteor 3, focusing on runtime and development experience with its bundler. It serves as a comparison point for various functionalities and helps catch any performance regressions.

This repository can inspire you to adapt the scripts and analyze performance in your applications. We're here to make the process easier, so feel free to share any feedback.

## What

This repository includes:

- Meteor applications for Meteor 2 and 3 to test performance, located in the `./apps` folder.
- Meteor packages for shared and isomorphic code, found in the `./packages` folder.
- Playwright tests to perform actions against the apps for runtime testing , found in `./tests`.
- Artillery configurations for stress testing your server, found in `./artillery`.
- Scripts to monitor performance and log results, found in `./scripts`.
- Logs from local monitoring runs, found in `./logs`.
- Benchmarks from official monitoring runs, found in `./benchmarks`.

## Requirements

- Unix System
- Node 20.x version

## Usage

Scripts are available to benchmark both runtime and bundler performance.

### Meteor runtime

Learn more of this process at [how to benchmark Meteor runtime](./RUNTIME.md).

### Meteor bundler

Learn more of this process at [how to benchmark Meteor bundler](./BUNDLER.md).
