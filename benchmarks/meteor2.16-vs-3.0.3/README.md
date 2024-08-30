# Benchmarks

## Meteor 2.16 vs 3.0.3

The purpose of benchmarking in 3.0.3 is to measure the impact of optimizations made to [address performance issues in reactive flows from version 3.0.1](../meteor2.16-vs-3.0.1), especially after disabling compression on reactive messages. Additional details on the changes can be [found here](https://github.com/meteor/meteor/pull/13320).

### Methodology

To verify Meteor's performance, we have two apps, `tasks-2.x` and `tasks-3.x`, that:

- Create 20 connection-scoped tasks via a button and a Meteor method.
- Remove each of the 20 tasks one by one via a button and a Meteor method.
- Display all tasks reactively using a Meteor subscription and non-reactively using a Meteor method that fetches them on each action.

This test measures the performance impact of Meteor 2 and 3, focusing on DDP protocol management for methods and subscriptions. Multiple runs trying to stress the machine with several configurations were performed to gather results.

### Machine Specs

- Meteor 2.16 and Meteor 3.0.3
- Intel Core Raptor Lake i9 13900K
- 64 RAM DDR5 6000 MHz CL30
- SSD WD Black SN850X
- Docker container

### Non-reactive Results

This test was run with the following artillery configuration:

- 240 connections in 1 minute. Every second, 4 new connections are made. Over 1 minute, tasks are created, removed, and visualized via a method (non-reactive).

#### Meteor 2 (compression)

| # Run | Time                 | CPU     | RAM    |
| ----- | -------------------- | ------- | ------ |
| 1     | 2 minutes 56 seconds | 117.41% | 471 MB |
| 2     | 2 minutes 38 seconds | 113.82% | 454 MB |
| 3     | 2 minutes 32 seconds | 115.46% | 454 MB |


#### Meteor 3 (no compression)

| # Run | Time                | CPU    | RAM    | Comparison with 2 (compression)                 |
| ----- | ------------------- | ------ | ------ | ----------------------------------------------- |
| 1     | 1 minute 40 seconds | 90.16% | 377 MB | 43.18% faster, 23.20% less cpu, 16.96% less ram |
| 2     | 1 minute 40 seconds | 98.49% | 389 MB | 36.70% faster, 13.47% less cpu,14.32% less ram  |
| 3     | 1 minute 50 seconds | 95.15% | 364 MB | 27.63% faster, 17.59% less cpu, 22.02% less ram |


This non-reactive scenario helps assess how removing compression in Meteor 3 improves performance compared to Meteor 2, which likely has compression enabled. A similar analysis is done for the reactive scenario in the next section.

Refer to the next section for a comparison of performance without compression in both Meteor 3 and Meteor 2. The fair analysis is also important to show that while disabling compression may improve performance in both versions, Meteor 3 might still have some regressions that need attention.

### Reactive Results

This test was run with the following artillery configuration:

- 240 connections in 1 minute. Every second, 4 new connections are made. Over 1 minute, tasks are created, removed, and visualized via a subscription (reactive).

#### Meteor 2 (compression)

| # Run | Time                 | CPU    | RAM    |
| ----- | -------------------- | ------ | ------ |
| 1     | 2 minutes 50 seconds | 87.66% | 602 MB |
| 2     | 2 minutes 52 seconds | 87.31% | 591 MB |
| 3     | 2 minutes 46 seconds | 88.54% | 587 MB |


####  Meteor 3 (no compression)

| # Run | Time                 | CPU    | RAM    | Comparison with 2 (compression)                 |
| ----- | -------------------- | ------ | ------ | ----------------------------------------------- |
| 1     | 2 minutes 30 seconds | 49.39% | 405 MB | 11.76% faster, 42.99% less cpu, 32.72% less ram |
| 2     | 2 minutes 34 seconds | 49.97% | 381 MB | 10.46% faster, 42.77% less cpu, 35.53% less ram |
| 3     | 2 minutes 24 seconds | 49.25% | 442 MB | 13.25% faster, 44.37% less cpu, 24.70% less ram |

#### Meteor 2 (no compression)

| # Run | Time                 | CPU    | RAM    | Comparison with 3 (no compression)              |
| ----- | -------------------- | ------ | ------ | ----------------------------------------------- |
| 1     | 2 minutes 12 seconds | 52.38% | 348 MB | 12% faster, 6.05% more cpu, 14.07% less ram |
| 2     | 2 minutes 10 seconds | 56.48% | 362 MB | 15.58% faster, 13.02% more cpu, 4.98% less ram |
| 3     | 2 minutes 10 seconds | 58.15% | 377 MB | 9.72% faster, 18.07% more cpu, 14.70% less ram |

Disabling compression in Meteor 2 also leads to significant gains. This suggests that while disabling compression might benefit your app, it may not be the main cause of the regression in Meteor 3. It's even faster and less RAM consuming than in Meteor 3.

### Conclusion

Meteor 3 is in average **~36% faster**, uses **~18% less CPU** and  **~17% less of RAM** in a **non-reactive scenario** without compression.

Meteor 3 is in average **~12% faster**, uses **~43% less CPU** and **~30% less of RAM** in a **reactive scenario** without compression.

Meteor 3, without compression, can manage 240 connections in 1 minute, a regression noted in the [3.0.1 report](../meteor2.16-vs-3.0.1#conclusion).

Meteor 2 can improve performance by disabling compression. Offering users the ability to adjust or disable compression effectively would be beneficial. However, the regression in Meteor 3 persists (initially identified in ), with higher RAM usage for the same process and more time introduced. This fact might still reveal the regression and requires further investigation.

