# Benchmarks

## Table of Contents

- [Introduction](#introduction)
- [Methodology](#methodology)
- [Specs](#specs)
- [Meteor 3.1.1 optimizations](#meteor-311-optimizations)
  * [Optimize AsyncQueue for parallelism](#optimize-asyncqueue-for-parallelism)
  * [Adjust compression defaults](#adjust-compression-defaults)
  * [Other research](#other-research)
- [Meteor 2.16 vs Meteor 3.1.1](#meteor-216-vs-meteor-311)
- [Conclusion](#conclusion)

## Introduction

In earlier Meteor 3 versions, we prepared several reports applying a benchmarking strategy to compare the performance of Meteor 3 runtime code with Meteor 2. The reports for [3.0.1](../meteor2.16-vs-3.0.1) and [3.0.3](../meteor2.16-vs-3.0.3-disable-compression) are available for your review.

Meteor 3 generally runs faster and uses fewer resources in non-reactive processes, benefiting significantly from the Node upgrade and promise migration. However, we observed a performance regression in reactive scenarios. Under stable conditions, Meteor 3 and Meteor 2 perform similarly, but under heavy connection loads, Meteor 3 struggles to maintain the number of connections that Meteor 2 handled with ease.

Reactivity is a key feature of Meteor, so we focused on boosting its performance, not only to match Meteor 2 under similar conditions but to exceed its throughput. With the updated Node engine, Meteor 3 delivers overall speed gains, and this should extend to reactivity as well.

Finally, in Metor 3.1.1, we resolved this issue after extensive research into the regression's causes. This report outlines those causes and highlights the improvements, supported by benchmark data from the reference machine. It also revisits the question of how much Meteor 3 outperforms Meteor 2 in reactive and non-reactive scenarios.

## Methodology

To verify Meteor's performance, we have two apps, `tasks-2.x` and `tasks-3.x`, that:

- Create 20 connection-scoped tasks via a button and a Meteor method.
- Remove each of the 20 tasks one by one via a button and a Meteor method.
- Display all tasks reactively using one Meteor subscription and non-reactively using one Meteor method that fetches them on each action.

This test measures the performance impact of Meteor 2 and 3, focusing on DDP protocol management for methods and subscriptions. Multiple runs trying to stress the machine with several configurations were performed to gather results.

> The test methodology follows an incremental approach, starting with simple setups and processes before moving to complex ones. If an issue arises in a simpler scenario, it provides a chance to address a more isolated performance problem, so we focus on analyzing and resolving it. Often, fixing issues in simpler examples can also improve performance in more complex scenarios, as these build on the same primitives.

## Specs

### Software

- Meteor 3.1.1
- Built-in Mongo
- Polling strategy for handling reactive data (high-demand scenario)
- Docker container

### Machine

- Intel Core Raptor Lake i9 13900K
- 64 RAM DDR5 6000 MHz CL30
- SSD WD Black SN850X

## Meteor 3.1.1 optimizations

### Optimize AsyncQueue for parallelism

The main reason Meteor 3 couldn't handle a high number of connections was that the AsyncQueue processed tasks one at a time. AsyncQueue handles tasks and is critical for reactive flows, so sudden increases in connection load caused the app to freeze, unable to process the load in time. By updating the AsyncQueue to support batching and parallel processing, we significantly improved both response time and the number of connections it can handle at once.

This test was run with the following artillery configuration:

- 180 connections in 1 minute. Every second, 3 new connections are made. Over 1 minute, tasks are created, removed, and visualized via a subscription (reactive).

| # Run | Time                | CPU    | RAM    |
| ----- | ------------------- | ------ | ------ |
| 1     | 1 minute 50 seconds | 72.13% | 588 MB |
| 2     | 1 minute 52 seconds | 72.69% | 554 MB |
| 3     | 1 minute 52 seconds | 69.43% | 556 MB |

Benchmark data shows significant improvement in time, [especially compared to version 3.0.1](../meteor2.16-vs-3.0.1#meteor-3-1), where we identified the regression. However, this change resulted in a notable increase in CPU and RAM usage, surpassing even Meteor 2.

After this change, we unlocked the ability to fix the regression identified in Meteor 3, which couldn't handle 240 connections per minute compared to Meteor 2, given the same machine specs. Furthermore, Meteor 3 can now support even more connections than Meteor 2.

The following tests were conducted for **3.1.1**, increasing the number of connections per second for the process:

| # Connections | Time                 | CPU    | RAM    | 2.16                                                   | 3.0.1                                                 |
| ------------- | -------------------- | ------ | ------ |--------------------------------------------------------|-------------------------------------------------------|
| 240           | 2 minutes 24 seconds | 73.32% | 767 MB | [ok](../meteor2.16-vs-3.0.1#alternative-configuration) | [x](../meteor2.16-vs-3.0.1#alternative-configuration) |
| 300           | 2 minutes 32 seconds | 79.24% | 827 MB | x                                                      | x                                                     |
| 360           | 3 minutes 10 seconds | 92.62% | 1.1 GB | x                                                      | x                                                     |
| 420           | x                    | x      | x      | x                                                      | x                                                     |

The asynchronous queue enabling parallelization has allowed Meteor 3 to surpass the connection limits seen in versions 2.16 and 3.0.1. Noticing a significant performance improvement from this change, we then analyzed CPU and RAM usage, which also increased, looking for further opportunities to enhance performance.

> As part of the changes in this section, we made additional code improvements that likely resulted in smaller-scale enhancements. A full description is available [in the PR](https://github.com/meteor/meteor/pull/13445).

### Adjust compression defaults

Once we enabled Meteor to surpass its connection limits and improve timing, we focused on optimizing CPU and RAM usage, which had grown significantly, as shown earlier.

After thorough research, we found, as in the 3.0.3 report, that compression code in Meteor 3 performs poorly due to the latest Node upgrade. A memory snapshot analysis showed that Meteor 3 uses significantly more memory for the same processes, load, and duration as Meteor 2.

Adjusting the compression to trigger at a specific message size and tweaking defaults for optimal speed resulted in significant benchmark improvements.

The following tests were conducted for **3.1.1**, increasing the number of connections per second for the process:

| # Connections | Time                 | CPU    | RAM    | 2.16                                                   | 3.0.1                                                 |
| ------------- | -------------------- | ------ | ------ |--------------------------------------------------------|-------------------------------------------------------|
| 180           | 1 minute 52 seconds  | 40.88% | 378 MB | [ok](../meteor2.16-vs-3.0.1#meteor-2-1)                | [ok](../meteor2.16-vs-3.0.1#meteor-3-1)               |
| 240           | 2 minutes 16 seconds | 38.22% | 480 MB | [ok](../meteor2.16-vs-3.0.1#alternative-configuration) | [x](../meteor2.16-vs-3.0.1#alternative-configuration) |
| 300           | 2 minutes 34 seconds | 43.44% | 528 MB | x                                                      | x                                                     |
| 360           | 3 minutes 18 seconds | 39.81% | 589 MB | x                                                      | x                                                     |
| 420           | 3 minutes 44 seconds | 43.39% | 760 MB | x                                                      | x                                                     |
| 480           | 4 minutes 36 seconds | 45.98% | 828 MB | x                                                      | x                                                     |
| 540           | x                    | x      | x      | x                                                      | x                                                     |

Adjusting compression has not only improved CPU and RAM performance, comparing with the previous async queue parallelization section, but also greatly increased the number of supported connections on the reference machine, from 360 to 480 in one minute for the same benchmark process.

> The compression configuration can be adjusted to meet individual needs. [A new guide](https://github.com/meteor/meteor/blob/3dac12a5990c10c6995b015e3c4500b0b451c9b5/v3-docs/docs/performance/websocket-compression.md) has been enabled for this.

### Other research

In our effort to identify the root causes of performance degradation, we explored several changes that could impact performance. However, they did not produce significant results, and we’d like to mention them.

- **Mongo driver and Node upgrade:** We considered that upgrading the Mongo driver or Node might affect performance, but benchmarking showed no change.
- **Node new async context (`--experimental-async-context-frame`) for AsyncLocalStorage:** While this new implementation was expected to perform better than async hooks, our benchmarks did not confirm this.
- **OPLOG vs pooling:** Switching from pooling to OPLOG in the benchmark did not yield any difference in results.
- **Node configurations (`--max-old-space-size`, `--max-semi-space-size`, and others):** These configurations did not improve performance and, in some cases, even worsened it or had a minimal effect.
- **DDP batching:** Although seen as a promising strategy, we encountered an obstacle in its implementation. It remains a point for future exploration.
- **Change streams:** Planned to improve performance and enhance reactive features in Meteor. Work hasn't started yet, but it's a priority for upcoming efforts.

## Meteor 2.16 vs Meteor 3.1.1

[TODO]
- Revisit and compare the latest status of Meteor 3.1.1 with the connection limits of Meteor 2.16 (240 connections per minute). To return to the original purpose of this performance work.

## Conclusion

[TODO]
- Summarize how Meteor 3 outperforms Meteor 2 in speed for reactive and non-reactive scenarios
- Briefly discuss future work efforts that will affect performance.
