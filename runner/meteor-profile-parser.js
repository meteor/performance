// Pure parser for `METEOR_PROFILE=1` output — extracted so both build
// aggregators (build_profile, plugin_compile) consume one parse of one build.
//
// REAL FORMAT (verified against a live `METEOR_PROFILE=1 meteor build` of
// tasks-3.x — sample at tests/unit/fixtures/meteor-profile-sample.txt; the
// numbered specs were hand-wavy, so the notes below are ground truth):
//
//   - Output goes to STDOUT, not stderr (the task brief assumed stderr).
//   - Every profile line starts with "| " (pipe + space). Non-"| " lines
//     (e.g. a bare "Warning: ...") are ignored.
//   - A data line is:  | <indent><name><pad><N> ms[ (<count>)]
//       <indent> encodes tree DEPTH via 3-column groups of box-drawing /
//         space runs: "│  ", "├─ ", "└─ ", or "   " (3 spaces). depth =
//         number of such leading groups. Top-level nodes have no indent.
//       <pad> is either dots ("....") when the node has children or spaces
//         when it doesn't — purely cosmetic, NOT depth. We strip trailing
//         dots/spaces off the name.
//       <N> and <count> may contain THOUSANDS COMMAS ("1,931 ms (40873)") —
//         stripped before Number().
//       count is OPTIONAL — synthetic "other X" roll-up lines omit it.
//   - Section/summary lines we DO read specially:
//       | (#1) Total: 6,202 ms (meteor build)  → the authoritative total_ms.
//     Lines we SKIP: "(#n) Profiling: ...", the "Top leaves:" block header
//     (its leaf rows are a duplicate ranking Meteor pre-computes — we rank
//     from the tree ourselves so the metric is self-consistent), and blank
//     "| " lines.
//
// total_ms comes from the `Total:` line, NOT from summing the tree: the tree
// timings nest (parent includes children) and overlap, so summing would
// double-count. Meteor's own Total is the wall-clock truth. If the Total line
// is absent (build crashed mid-profile) total_ms is null and the caller
// degrades gracefully.
//
// Defensive by design (the format is undocumented and may shift between
// Meteor releases): any line that doesn't match the data pattern is skipped,
// never thrown on. Partial/truncated output parses to whatever matched.

const LINE_PREFIX = '| ';
// One depth level of indentation: a box-drawing branch/pipe or 3 spaces.
// Matched repeatedly from the start of the post-prefix string.
const INDENT_UNIT = /^(?:│\s{2}|├─\s|└─\s|\s{3})/;
// name (lazy) + dot/space padding + "N ms" + optional "(count)".
const DATA_RE = /^(.*?)[.\s]*(\d[\d,]*)\s*ms(?:\s*\((\d[\d,]*)\))?\s*$/;
const TOTAL_RE = /Total:\s*([\d,]+)\s*ms/;

function toNum(s) {
  return Number(String(s).replace(/,/g, ''));
}

export function parseMeteorProfile(text) {
  const nodes = [];
  let totalMs = null;
  // "Top leaves:" is a trailing block of pre-ranked leaf rows that DUPLICATE
  // tree entries (e.g. files.readFile appears both in-tree and as a top leaf).
  // Counting both would double-rank it, so we skip the whole block: from its
  // header until the next blank "| " line or the Total line.
  let inTopLeaves = false;
  if (typeof text !== 'string' || text.length === 0) {
    return { total_ms: null, nodes };
  }

  for (const rawLine of text.split('\n')) {
    if (!rawLine.startsWith(LINE_PREFIX)) continue;
    let rest = rawLine.slice(LINE_PREFIX.length);

    // The authoritative total — capture and move on (it also matches DATA_RE
    // loosely, so handle it first). Also ends the Top-leaves block.
    if (rest.includes('Total:')) {
      const m = rest.match(TOTAL_RE);
      if (m) totalMs = toNum(m[1]);
      inTopLeaves = false;
      continue;
    }
    // Blank "| " line ends the Top-leaves block (and is never data).
    if (rest.trim() === '') {
      inTopLeaves = false;
      continue;
    }
    if (rest.startsWith('Top leaves:')) { inTopLeaves = true; continue; }
    if (inTopLeaves) continue;
    // Section headers / non-data lines.
    if (rest.includes('Profiling:')) continue;

    // Peel off depth indentation, counting 3-column groups.
    let depth = 0;
    let guard = 0;
    while (guard++ < 100) {
      const m = rest.match(INDENT_UNIT);
      if (!m) break;
      depth++;
      rest = rest.slice(m[0].length);
    }

    const data = rest.match(DATA_RE);
    if (!data) continue;
    const name = data[1].trim();
    if (!name) continue;
    nodes.push({
      name,
      self_ms: toNum(data[2]),
      count: data[3] != null ? toNum(data[3]) : null,
      depth,
    });
  }

  return { total_ms: totalMs, nodes };
}
