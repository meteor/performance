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

- Every second, 4 new connections are made. Over 1 minute, tasks are created, removed, and visualized for non-reactive.

#### Meteor 2

| # Run | Time                 | CPU     | RAM    |
| ----- | -------------------- | ------- | ------ |
| 1     | 2 minutes 56 seconds | 117.41% | 471 MB |
| 2     | 2 minutes 38 seconds | 113.82% | 454 MB |
| 3     | 2 minutes 32 seconds | 115.46% | 454 MB |


####  Meteor 3

| # Run | Time                | CPU    | RAM    | Comparison with 2                               |
| ----- | ------------------- | ------ | ------ | ----------------------------------------------- |
| 1     | 1 minute 40 seconds | 90.16% | 377 MB | 43.18% faster, 23.20% less cpu, 16.96% less ram |
| 2     | 1 minute 40 seconds | 98.49% | 389 MB | 36.70% faster, 13.47% less cpu,14.32% less ram  |
| 3     | 1 minute 50 seconds | 95.15% | 364 MB | 27.63% faster, 17.59% less cpu, 22.02% less ram |


### Reactive Results

This test was run with the following artillery configuration:

- Every second, 4 new connections are made. Over 1 minute, tasks are created, removed, and visualized for reactive.

#### Meteor 2

| # Run | Time                 | CPU    | RAM    |
| ----- | -------------------- | ------ | ------ |
| 1     | 2 minutes 50 seconds | 87.66% | 602 MB |
| 2     | 2 minutes 52 seconds | 87.31% | 591 MB |
| 3     | 2 minutes 46 seconds | 88.54% | 587 MB |


####  Meteor 3

| # Run | Time                 | CPU    | RAM    | Comparison with 2                               |
| ----- | -------------------- | ------ | ------ | ----------------------------------------------- |
| 1     | 2 minutes 30 seconds | 49.39% | 405 MB | 11.76% faster, 42.99% less cpu, 32.72% less ram |
| 2     | 2 minutes 34 seconds | 49.97% | 381 MB | 10.46% faster, 42.77% less cpu, 35.53% less ram |
| 3     | 2 minutes 24 seconds | 49.25% | 442 MB | 13.25% faster, 44.37% less cpu, 24.70% less ram |

### Conclusion

Meteor 3 is in average **~36% faster**, uses **~18% less CPU** and  **~17% less of RAM** in a **non-reactive scenario**.

Meteor 3 is in average **~12% faster**, uses **~43% less CPU** and **~30% less of RAM** in a **reactive scenario**.

The improvement [from the previous version 3.0.1 report](../meteor2.16-vs-3.0.1#conclusion) is substantial. Both scenarios show better performance, with the reactive scenario showing a significant boost.
