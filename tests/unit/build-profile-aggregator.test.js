import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateBuildProfile } from '../../runner/build-profile-aggregator.js';

const node = (name, self_ms, depth = 0, count = 1) => ({ name, self_ms, count, depth });

describe('aggregateBuildProfile', () => {
  test('null / empty tree → null (absence convention CC-5)', () => {
    assert.equal(aggregateBuildProfile(null), null);
    assert.equal(aggregateBuildProfile({}), null);
    assert.equal(aggregateBuildProfile({ nodes: [] }), null);
    assert.equal(aggregateBuildProfile({ total_ms: 100, nodes: [] }), null);
  });

  test('ranks by self_ms descending', () => {
    const parsed = { total_ms: 100, nodes: [node('a', 10), node('b', 50), node('c', 30)] };
    const r = aggregateBuildProfile(parsed, { topN: 3 });
    assert.deepEqual(r.top_nodes.map((n) => n.name), ['b', 'c', 'a']);
  });

  test('topN cap respected; top_n_count reflects returned length', () => {
    const nodes = [];
    for (let i = 0; i < 100; i++) nodes.push(node(`n${i}`, i));
    const r = aggregateBuildProfile({ total_ms: 10000, nodes }, { topN: 5 });
    assert.equal(r.top_nodes.length, 5);
    assert.equal(r.top_n_count, 5);
    // highest self_ms are 99,98,97,96,95
    assert.deepEqual(r.top_nodes.map((n) => n.self_ms), [99, 98, 97, 96, 95]);
  });

  test('topN default is 5', () => {
    const nodes = [];
    for (let i = 0; i < 20; i++) nodes.push(node(`n${i}`, i));
    const r = aggregateBuildProfile({ total_ms: 1000, nodes });
    assert.equal(r.top_n_count, 5);
  });

  test('fewer nodes than topN → returns all, top_n_count = node count', () => {
    const r = aggregateBuildProfile({ total_ms: 100, nodes: [node('a', 10), node('b', 20)] }, { topN: 5 });
    assert.equal(r.top_n_count, 2);
    assert.equal(r.top_nodes.length, 2);
  });

  test('top_n_total_ms = sum of top self_ms; long_tail_ms = total - top_n_total', () => {
    const parsed = { total_ms: 100, nodes: [node('a', 50), node('b', 20), node('c', 5)] };
    const r = aggregateBuildProfile(parsed, { topN: 2 });
    assert.equal(r.top_n_total_ms, 70); // 50 + 20
    assert.equal(r.long_tail_ms, 30); // 100 - 70
  });

  test('long_tail_ms clamps at 0 when top exceeds total (degenerate/missing total)', () => {
    const parsed = { total_ms: 0, nodes: [node('a', 50)] };
    const r = aggregateBuildProfile(parsed, { topN: 1 });
    assert.equal(r.long_tail_ms, 0);
  });

  test('missing total_ms treated as 0', () => {
    const r = aggregateBuildProfile({ nodes: [node('a', 10)] }, { topN: 1 });
    assert.equal(r.total_ms, 0);
    assert.equal(r.long_tail_ms, 0);
  });

  test('children_ms sums descendants (deeper contiguous run), stops at sibling', () => {
    // a(d0,10) > [b(d1,5) > c(d2,3)], then d(d0,1) is a sibling of a.
    const parsed = {
      total_ms: 20,
      nodes: [node('a', 10, 0), node('b', 5, 1), node('c', 3, 2), node('d', 1, 0)],
    };
    const r = aggregateBuildProfile(parsed, { topN: 1 });
    // top node is 'a'; its descendants are b(5)+c(3)=8; d is a sibling, excluded.
    assert.equal(r.top_nodes[0].name, 'a');
    assert.equal(r.top_nodes[0].children_ms, 8);
  });

  test('leaf node has children_ms 0', () => {
    const parsed = { total_ms: 10, nodes: [node('a', 10, 0), node('b', 2, 0)] };
    const r = aggregateBuildProfile(parsed, { topN: 1 });
    assert.equal(r.top_nodes[0].children_ms, 0);
  });

  test('top node carries name/self_ms/count/children_ms', () => {
    const parsed = { total_ms: 10, nodes: [node('bundler.bundle', 8, 0, 1)] };
    const r = aggregateBuildProfile(parsed, { topN: 1 });
    assert.deepEqual(Object.keys(r.top_nodes[0]).sort(), ['children_ms', 'count', 'name', 'self_ms']);
    assert.equal(r.top_nodes[0].count, 1);
  });

  test('shape contract: metric name + exact top-level key set', () => {
    const r = aggregateBuildProfile({ total_ms: 100, nodes: [node('a', 10)] }, { topN: 5 });
    assert.equal(r.metric, 'build_profile');
    assert.deepEqual(
      Object.keys(r).sort(),
      ['long_tail_ms', 'metric', 'top_n_count', 'top_n_total_ms', 'top_nodes', 'total_ms'],
    );
  });
});
