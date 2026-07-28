// Pure aggregation for the change-stream cursor sampler — extracted from
// the standalone collector so it's unit-testable without spinning up
// MongoClient or a child process.
//
// Input: the raw shape the collector accumulates —
//   { interval_ms,
//     samples: [{ ts, cursorCount, perNs: { ns: count } }, ...] }
// Output: the `metrics.mongo_changestream` shape — cursor_count as a
// time-series with min/max/avg/end, plus by_namespace with max + avg per
// namespace.
//
// Returns null when there are no samples (absence convention CC-5: the
// collector ran but captured nothing → caller omits the key entirely).
// Note: a run where the oplog driver is in use still produces samples
// (all cursorCount 0), so the key is emitted with zeros — that's the
// informative "no change streams were open" signal, distinct from the
// collector not running at all.
//
// cursor_count is a point-in-time gauge → min/max/avg/end. by_namespace
// avg is over ALL samples (a namespace absent from a sample counts as 0
// for that sample), so avg = total-count-for-ns / sample-count; max is
// the highest count seen for that ns in any single sample (max-merged
// across samples). avg rounds to one decimal; min/max/end are integers.

function statsFor(values) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return {
    min,
    max,
    avg: +(sum / values.length).toFixed(1),
    end: values[values.length - 1],
  };
}

export function aggregateChangestream(dump) {
  const { interval_ms, samples } = dump || {};
  if (!Array.isArray(samples) || samples.length === 0) return null;

  const counts = samples.map((s) => Number(s.cursorCount ?? 0));

  // Per-namespace: max in any single sample + avg over all samples.
  const nsMax = {};
  const nsSum = {};
  for (const s of samples) {
    const perNs = s.perNs || {};
    for (const ns of Object.keys(perNs)) {
      const c = Number(perNs[ns] ?? 0);
      if (c > (nsMax[ns] ?? -Infinity)) nsMax[ns] = c;
      nsSum[ns] = (nsSum[ns] || 0) + c;
    }
  }
  const by_namespace = {};
  for (const ns of Object.keys(nsMax)) {
    by_namespace[ns] = {
      max: nsMax[ns],
      avg: +(nsSum[ns] / samples.length).toFixed(1),
    };
  }

  return {
    metric: 'mongo_changestream',
    samples: samples.length,
    interval_ms,
    cursor_count: statsFor(counts),
    by_namespace,
  };
}
