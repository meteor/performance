// Pure aggregation for the build_profile metric — consumes the parsed
// METEOR_PROFILE tree (runner/meteor-profile-parser.js output) and surfaces
// the top-N hottest nodes by self_ms plus a long-tail roll-up, per task 20.
//
// Input: { total_ms, nodes:[{ name, self_ms, count, depth }] } from the
// parser. Output: the metrics.build_profile shape.
//
// Ranking is on self_ms (time IN a node, exclusive of children) — that's the
// true CPU hot-spot, per the spec. children_ms is reported per top node for
// context: it's the sum of self_ms across that node's DESCENDANTS in the
// flat list (the contiguous run of deeper-depth nodes that follow it). It's
// computed only for the N top nodes (cheap), not every node.
//
// Accounting: top_n_total_ms = sum of the top nodes' self_ms; long_tail_ms =
// total_ms - top_n_total_ms (all remaining build time). total_ms comes from
// Meteor's authoritative "Total:" line (parser), NOT a tree sum, so long_tail
// is honest even though tree timings nest. Clamped at 0 so a degenerate parse
// (top self_ms exceeding a missing/zero total) can't report negative tail.
//
// Absence (CC-5): returns null when the tree has no nodes (empty/failed
// parse) so the caller omits the metric key.

// Sum self_ms of the descendants of nodes[i]: the contiguous run of nodes
// after i whose depth is greater than nodes[i].depth (stops at the next
// sibling-or-shallower node).
function childrenMsAt(nodes, i) {
  const parentDepth = nodes[i].depth;
  let sum = 0;
  for (let j = i + 1; j < nodes.length; j++) {
    if (nodes[j].depth <= parentDepth) break;
    sum += nodes[j].self_ms;
  }
  return sum;
}

export function aggregateBuildProfile(parsed, { topN = 5 } = {}) {
  const nodes = parsed?.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) return null;

  // Index map so we can find each node's original position (for childrenMsAt)
  // after sorting a copy by self_ms.
  const indexed = nodes.map((n, i) => ({ n, i }));
  indexed.sort((a, b) => b.n.self_ms - a.n.self_ms);

  const top = indexed.slice(0, topN).map(({ n, i }) => ({
    name: n.name,
    self_ms: n.self_ms,
    children_ms: childrenMsAt(nodes, i),
    count: n.count,
  }));

  const topNTotalMs = top.reduce((acc, n) => acc + n.self_ms, 0);
  const totalMs = Number(parsed?.total_ms ?? 0);
  const longTailMs = Math.max(0, totalMs - topNTotalMs);

  return {
    metric: 'build_profile',
    total_ms: totalMs,
    top_nodes: top,
    top_n_count: top.length,
    top_n_total_ms: topNTotalMs,
    long_tail_ms: longTailMs,
  };
}
