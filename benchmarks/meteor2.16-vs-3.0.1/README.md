# Benchmarks

## Meteor 2.16 vs 3.0.1

### Methodology

To verify Meteor's performance, we have two apps, `tasks-2.x` and `tasks-3.x`, that:

- Create 20 connection-scoped tasks via a button and a Meteor method.
- Remove each of the 20 tasks one by one via a button and a Meteor method.
- Display all tasks reactively using one Meteor subscription and non-reactively using one Meteor method that fetches them on each action.

This test measures the performance impact of Meteor 2 and 3, focusing on DDP protocol management for methods and subscriptions. Multiple runs trying to stress the machine with several configurations were performed to gather results.

> The test methodology follows an incremental approach, starting with simple setups and processes before moving to complex ones. If an issue arises in a simpler scenario, it provides a chance to address a more isolated performance problem, so we focus on analyzing and resolving it. Often, fixing issues in simpler examples can also improve performance in more complex scenarios, as these build on the same primitives.

### Specs

#### Software

- Meteor 2.16 and Meteor 3.0.1
- Built-in Mongo
- Polling strategy for handling reactive data (high-demand scenario)
- Docker container

#### Machine

- Intel Core Raptor Lake i9 13900K
- 64 RAM DDR5 6000 MHz CL30
- SSD WD Black SN850X

### Non-reactive results

This test was run with the following artillery configuration:

- 240 connections in 1 minute. Every second, 4 new connections are made. Over 1 minute, tasks are created, removed, and visualized via a method (non-reactive).

#### Meteor 2

| # Run | Time                 | CPU     | RAM    |
| ----- | -------------------- | ------- | ------ |
| 1     | 2 min 42 seconds     | 116,06% | 442 MB |
| 2     | 2 minutes 50 seconds | 118.29% | 458 MB |
| 3     | 3 minutes            | 116.87% | 455 MB |

####  Meteor 3

| # Run | Time                | CPU     | RAM    | Comparison with 2                               |
| ----- | ------------------- | ------- | ------ | ----------------------------------------------- |
| 1     | 1 minute 56 seconds | 110.85% | 369 MB | 28.39% faster, 4.48% less cpu, 16.51% less ram  |
| 2     | 2 minutes 2 seconds | 101.21% | 390 MB | 28.23% faster, 14.43% less cpu, 15.03% less ram |
| 3     | 2 minutes 6 seconds | 104.90% | 377 MB | 30% faster, 10.24% less cpu, 17.14% less ram    |

### Reactive results

This test was run with the following artillery configuration:

- 180 connections in 1 minute. Every second, 3 new connections are made. Over 1 minute, tasks are created, removed, and visualized via a subscription (reactive).

#### Meteor 2

| # Run | Time            | CPU    | RAM    |
| ----- | --------------- | ------ | ------ |
| 1     | 2 min 6 seconds | 78,19% | 406 MB |
| 2     | 2 min 4 seconds | 79.09% | 419 MB |
| 3     | 2 min 6 seconds | 79,54% | 439 MB |

####  Meteor 3

| # Run | Time                | CPU    | RAM    | Comparison with 2                         |
| ----- | ------------------- | ------ | ------ | ----------------------------------------- |
| 1     | 2 min 4 seconds     | 65.05% | 454 MB | ~= time, 16.80% less cpu, 11.82% more ram |
| 2     | 2 minutes 6 seconds | 65.02% | 470 MB | ~= time, 17.79% less cpu, 12.17% more ram |
| 3     | 2 min 10 seconds    | 64.44% | 460 MB | ~= time, 18.98% less cpu, 4.78% more ram  |

#### Alternative configuration 

Another detail to note is that in a reactive scenario, Meteor 3.0 crashes when handling subscription data for 240 connections in 1 minute. Meteor 2.0 manages this, suggesting **a possible regression in 3.0**. The configuration of 180 connections in 1 minute is used to be able to compare both effectively.

Meteor 2 result of successful run with **240 connections in 1 minute** is as follow:

| # Run | Time             | CPU    | RAM    |
| ----- |------------------|--------|--------|
| 1     | 2 min 52 seconds | 87,00% | 497 MB |


### Remote results

#### Galaxy container specs

Compact (Pro)
512MB
0.5 ECU

#### Results

We also used our remote setup to stress test the apps. Remote testing on Galaxy provides additional metrics beyond those from the Monti APM tool. We use this data to explore regression causes, implement fixes, or assess configurations for improved performance.

For example, when comparing "PubSub response time" and "Method response time" in both reactive and non-reactive scenarios, the results indicate that in Meteor 2, subscriptions are faster and methods are slower. In contrast, Meteor 3 shows the opposite pattern with the same process.

![image](https://github.com/user-attachments/assets/0d8d2d68-880d-4628-8fbc-6d47775247ec)

### Conclusion

Meteor 3 is in average **~28% faster**, uses **~10% less CPU** and  **~16% less of RAM** in a **non-reactive scenario**.

Meteor 3 is in average **~equal on time**, uses **~18% less CPU** and **~10% more of RAM** in a **reactive scenario**.

Meteor 3 shows a performance regression when exceeding 180 connections per minute in a **reactive scenario**; it can't handle the load, causing the process to break. We should investigate how to improve Meteor 3 with this machine configuration to manage a configuration with at least 240 connections per minute, as Meteor 2 does.
