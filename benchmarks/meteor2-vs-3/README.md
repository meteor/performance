# Benchmarks

## Meteor 2 vs 3

To verify Meteor's performance, we have two apps, `tasks-2.x` and `tasks-3.x`, that:

- Create 20 connection-scoped tasks via a button and a Meteor method.
- Remove each of the 20 tasks one by one via a button and a Meteor method.
- Display all tasks reactively using a Meteor subscription and non-reactively using a Meteor method that fetches them on each action.

This test measures the performance impact of Meteor 2 and 3, focusing on DDP protocol management for methods and subscriptions. Multiple runs trying to stress the machine with several configurations were performed to gather results.

### Machine Specs

- Meteor 2.16 and Meteor 3.0.1
- Intel Core Raptor Lake i9 13900K
- 64 RAM DDR5 6000 MHz CL30
- SSD WD Black SN850X
- Docker container

### Non-reactive Results

This test was run with the following artillery configuration:

- Every second, 4 new connections are made. Over 1 minute, tasks are created, removed, and visualized for non-reactive.

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

### Reactive Results

This test was run with the following artillery configuration:

- Every second, 3 new connections are made. Over 1 minute, tasks are created, removed, and visualized for reactive.

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

Another detail to note is that in a reactive scenario, Meteor 3.0 crashes when handling subscription data for 4 new connections per second over a minute. Meteor 2.0 manages this, suggesting a possible regression in 3.0. The configuration of 3 connections per second is used to be able to compare both effectively.

Meteor 2 result of successful run with 4 connections per second is as follow:

| # Run | Time             | CPU    | RAM    |
| ----- |------------------|--------|--------|
| 1     | 2 min 52 seconds | 87,00% | 497 MB |

### Conclusion

Meteor 3 is in average **~28% faster**, uses **~10% less CPU** and  **~16% less of RAM** in a **non-reactive scenario**.

Meteor 3 is in average **~equal on time**, uses **~18% less CPU** and **~10% more of RAM** in a **reactive scenario**.
