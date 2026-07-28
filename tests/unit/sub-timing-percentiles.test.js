import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateSubTiming } from '../../runner/collectors.js';

describe('aggregateSubTiming', () => {
  test('returns null when input is empty (per absence convention)', () => {
    assert.equal(aggregateSubTiming({}), null);
    assert.equal(aggregateSubTiming(null), null);
    assert.equal(aggregateSubTiming(undefined), null);
  });

  test('returns null when all publication arrays are empty', () => {
    // Edge case: publications registered but no sub ever completed ready
    assert.equal(aggregateSubTiming({ fetchTasks: [], otherPub: [] }), null);
  });

  test('produces canonical shape for { fetchTasks: [10, 20, 30] }', () => {
    const result = aggregateSubTiming({ fetchTasks: [10, 20, 30] });
    assert.deepEqual(result, {
      metric: 'ddp_subscriptions',
      publications: {
        fetchTasks: {
          count: 3,
          avg_ms: 20,
          p50: 20,
          p95: 30,
          p99: 30,
          max_ms: 30,
        },
      },
      total_subs: 3,
    });
  });

  test('single sample collapses all stats to that value', () => {
    const result = aggregateSubTiming({ fetchTasks: [42] });
    assert.deepEqual(result.publications.fetchTasks, {
      count: 1,
      avg_ms: 42,
      p50: 42,
      p95: 42,
      p99: 42,
      max_ms: 42,
    });
  });

  test('multiple publications aggregate independently and sum to total_subs', () => {
    const result = aggregateSubTiming({
      fetchTasks: [10, 20, 30, 40, 50],
      userProfile: [5, 15],
      notifications: [3],
    });
    assert.equal(result.total_subs, 8);
    assert.equal(result.publications.fetchTasks.count, 5);
    assert.equal(result.publications.userProfile.count, 2);
    assert.equal(result.publications.notifications.count, 1);
    assert.equal(result.publications.fetchTasks.p50, 30);
    assert.equal(result.publications.userProfile.avg_ms, 10);
  });

  test('large array (1000 samples) computes percentiles correctly', () => {
    const samples = Array.from({ length: 1000 }, (_, i) => i + 1);
    const result = aggregateSubTiming({ fetchTasks: samples });
    assert.equal(result.publications.fetchTasks.count, 1000);
    assert.equal(result.publications.fetchTasks.avg_ms, 500.5);
    assert.equal(result.publications.fetchTasks.p50, 500);
    assert.equal(result.publications.fetchTasks.p95, 950);
    assert.equal(result.publications.fetchTasks.p99, 990);
    assert.equal(result.publications.fetchTasks.max_ms, 1000);
  });

  test('publication names with dots (e.g. meteor.loginServiceConfiguration) survive as object keys', () => {
    const result = aggregateSubTiming({ 'meteor.loginServiceConfiguration': [100, 200] });
    assert.ok(result.publications['meteor.loginServiceConfiguration']);
    assert.equal(result.publications['meteor.loginServiceConfiguration'].count, 2);
  });

  test('publications with empty sample arrays are omitted (per absence convention)', () => {
    const result = aggregateSubTiming({
      fetchTasks: [10, 20],
      neverReady: [],
    });
    assert.equal(result.total_subs, 2);
    assert.ok(result.publications.fetchTasks);
    assert.equal(result.publications.neverReady, undefined);
  });

  test('output uses BARE percentile suffix (CC-4: p50, p95, p99 — no _ms)', () => {
    const result = aggregateSubTiming({ fetchTasks: [10] });
    const fields = Object.keys(result.publications.fetchTasks);
    assert.ok(fields.includes('p50'), 'expected bare p50');
    assert.ok(fields.includes('p95'), 'expected bare p95');
    assert.ok(fields.includes('p99'), 'expected bare p99');
    assert.ok(!fields.includes('p50_ms'), 'should NOT have p50_ms (CC-4 violation)');
  });

  test('output uses _ms suffix on non-percentile latency scalars', () => {
    const result = aggregateSubTiming({ fetchTasks: [10] });
    const fields = Object.keys(result.publications.fetchTasks);
    assert.ok(fields.includes('avg_ms'), 'expected avg_ms suffix');
    assert.ok(fields.includes('max_ms'), 'expected max_ms suffix');
  });

  test('top-level metric field is "ddp_subscriptions" (collector self-identifies)', () => {
    const result = aggregateSubTiming({ fetchTasks: [10] });
    assert.equal(result.metric, 'ddp_subscriptions');
  });

  test('total_subs sums across publications, mirroring ddp_methods.total_calls semantic', () => {
    const result = aggregateSubTiming({
      fetchTasks: [1, 2, 3],
      userProfile: [4, 5],
    });
    assert.equal(result.total_subs, 5);
  });
});
