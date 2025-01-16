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

Benchmark data shows significant improvement in time, [especially compared to version 3.0.1](../meteor2.16-vs-3.0.1#meteor-3-1). However, this change resulted in a notable increase in CPU and RAM usage, surpassing even Meteor 2.

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

After thorough research, we found, as in the [3.0.3 report](../meteor2.16-vs-3.0.3-disable-compression), that compression code in Meteor 3 performs poorly due to the latest Node upgrade. A memory snapshot analysis showed that Meteor 3 uses significantly more memory for the same processes, load, and duration as Meteor 2.

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

- **Mongo driver and Node upgrade:** We considered that upgrading the Mongo driver or Node might affect performance, but reactive scenario benchmarking showed no change.
- **Node new async context (`--experimental-async-context-frame`) for AsyncLocalStorage:** While this new implementation was expected to perform better than async hooks, our benchmarks did not confirm this.
- **OPLOG vs pooling:** Switching from pooling to OPLOG in the benchmark did not yield any difference in results.
- **Node configurations (`--max-old-space-size`, `--max-semi-space-size`, and others):** These configurations did not improve performance and, in some cases, even worsened it or had a minimal effect.
- **DDP batching:** Although seen as a promising strategy, we encountered an obstacle in its implementation. It remains a point for future exploration.
- **Change streams:** Planned to improve performance and enhance reactive features in Meteor. Work hasn't started yet, but it's a priority for upcoming efforts.

## Meteor 2.16 vs Meteor 3.1.1

In earlier sections, we outlined the optimization changes implemented to address a performance regression in reactive scenarios and connection capacity using the benchmark processes described.

This section summarizes the last status of Meteor 3.1.1 compared to Meteor 2.16 under a fixed number of connections.

#### Reactive Results

This test was run with the following artillery configuration:

- 240 connections in 1 minute. Every second, 4 new connections are made. Over 1 minute, tasks are created, removed, and visualized via a subscription (reactive).

##### Meteor 2.16

| # Run | Time                 | CPU    | RAM    |
| ----- | -------------------- | ------ | ------ |
| 1     | 2 minutes 58 seconds | 85.89% | 582 MB |
| 2     | 2 minutes 56 seconds | 90.95% | 529 MB |
| 3     | 2 minutes 58 seconds | 85.15% | 597 MB |

#####  Meteor 3.1.1

| # Run | Time                 | CPU    | RAM    | Comparison with 2                                |
| ----- | -------------------- | ------ | ------ | ------------------------------------------------ |
| 1     | 2 minutes 6 seconds  | 43.67% | 451 MB | 29.21% faster, 49.15% less cpu, 22.50% less ram  |
| 2     | 2 minutes 4 seconds  | 42.94% | 495 MB | 29.54% faster, 52.79% less cpu, 6.42% less ram   |
| 3     | 2 minutes 14 seconds | 41.62% | 463 MB | 24.71% faster, 51.12% less cpu, 22.44% less ram  |

Async queues and compression provide significant improvements across all tasks involved in the benchmark process.

#### Non-Reactive Results


This test was run with the following artillery configuration:

- 240 connections in 1 minute. Every second, 4 new connections are made. Over 1 minute, tasks are created, removed, and visualized via a method (non-reactive).

##### Meteor 2.16

| # Run | Time                 | CPU     | RAM    |
| ----- | -------------------- | ------- | ------ |
| 1     | 2 minutes 36 seconds | 110.78% | 421 MB |
| 2     | 2 minutes 30 seconds | 109.39% | 423 MB |
| 3     | 2 minutes 28 seconds | 111.79% | 437 MB |

##### Meteor 3.1.1

| # Run | Time                | CPU     | RAM    | Comparison with 2.16                            |
| ----- | ------------------- | ------- | ------ | ----------------------------------------------- |
| 1     | 2 minutes 6 seconds | 144.91% | 551 MB | 19.23% faster, 30.80% more cpu, 30.87% more ram |
| 2     | 2 minutes 6 seconds | 139.99% | 552 MB | 16% faster, 27.97% more cpu,  30.49% more ram   |
| 3     | 1 minute 56 seconds | 142.75% | 523 MB | 21.62% faster, 27.69% more cpu, 19.67% more ram |

In a non-reactive scenario, where we rely more on Meteor methods and continuously resolve more Mongo queries and large objects to be transmitted, performance remains better 2.16. However, CPU usage has increased substantially, likely because parallelization demands more resources for larger operations without reducing execution time in this case.

RAM usage has also risen, though we don’t believe this is related to the optimization changes. Interestingly, we noticed that with the Meteor 3.1 upgrade, which included no performance optimizations but updated Meteor tooling, CPU and RAM usage worsened. We believe this is mainly due to the Mongo driver upgrade, as Meteor 3.1 included a two-major version update to the MongoDB driver.

The data for Meteor 3.0.2 and Meteor 3.1 is as follows.

#####  Meteor 3.0.2

| # Run | Time                | CPU     | RAM    |
| ----- | ------------------- | ------- | ------ |
| 1     | 1 minute 56 seconds | 110.85% | 369 MB |
| 2     | 2 minutes 2 seconds | 101.21% | 390 MB |
| 3     | 2 minutes 6 seconds | 104.90% | 377 MB |
##### Meteor 3.1

| # Run | Time                 | CPU     | RAM    |
| ----- | -------------------- | ------- | ------ |
| 1     | 2 minutes 4 seconds  | 119.91% | 666 MB |
| 2     | 2 minutes 2 seconds  | 125.73% | 666 MB |
| 3     | 2 minutes 14 seconds | 116.88% | 664 MB |

- Meteor 3.1 increased CPU and RAM usage for the same process compared to 3.0.2.
- Meteor 3.1.1 improved RAM usage over 3.1, likely due to compression changes.

> Note: While results may vary slightly between runs due to machine and process conditions, the values are approximate. Multiple runs show a clear trend, highlighting how the change significantly impacted performance metrics.

## Conclusion

Performance is an ongoing effort that requires continuous attention. The performance suite helps detect regressions and uncover improvements in future Meteor versions.

With basic benchmark tests covering reactive and non-reactive scenarios, we identified a regression and fixed it.

We also found that upgrading some tools in the Meteor ecosystem increased resource consumption on the machine. We observed that 3.1 introduced regressions in CPU and RAM usage after upgrading some Meteor tools. We need to assess what exactly caused it and whether it can be improved or if it's a trade-off we must accept with the new major version of those tools.

Performance is highly variable and depends on your use case coverage. Looking ahead, we aim to develop a more real benchmarking process. This would test additional Meteor scenarios (like having more observers, collections and subscriptions) while incorporating widely used community packages from real-world applications (publish-composite, redis-oplog, apm, etc).

After reviewing the report, we can conclude that:

Meteor **3.1.1** is in average **~28% faster**, uses **~51% less CPU** and **~17% less of RAM** in a **reactive scenario**, compared with 2.16.

Meteor **3.1.1** is in average **~19% faster**, uses **~28,82% more CPU** and **~27% more of RAM** in a **non-reactive scenario**, compared with 2.16.

Meteor 3.1.1 **unlocks connection limits** thanks to async queue parallelization improvements, compared with 2.16 and 3.0.2.

Meteor **3.1** introduced more CPU and RAM usage in **non-reactive scenario** likely due to Mongo driver upgrade, compared with 3.0.2.
