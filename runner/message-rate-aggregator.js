// Pure rate math for the ddp-message collector — extracted from the
// in-app monitor's raw dump so it's unit-testable without spinning up a
// Meteor server.
//
// Input: the dump written by ddp-message-counter.server.js —
//   { startTime, endTime, by_in: {type: count}, by_out: {type: count} }
// (RAW counts; the monitor deliberately doesn't compute rates so the
// duration window is the wall-clock the dump file spans.)
// Output: the `metrics.ddp_messages` shape per the task 07 spec —
// total_in/out, in/out per-second, and the per-type breakdown.
//
// Absence (CC-5): returns null when no messages were observed at all
// (both totals zero) so the caller omits the metric key entirely.
//
// duration <= 0 → rates are 0 (avoid divide-by-zero when the dump is
// captured before any wall-clock time passed). Per-second rates use the
// `<name>_per_sec` convention (CC-4: no percentiles here, just rates).

function sumCounts(byType) {
  let total = 0;
  for (const key of Object.keys(byType || {})) {
    total += Number(byType[key] ?? 0);
  }
  return total;
}

export function aggregateDdpMessages(dump) {
  if (!dump) return null;
  const { startTime, endTime, by_in, by_out } = dump;
  const totalIn = sumCounts(by_in);
  const totalOut = sumCounts(by_out);
  if (totalIn === 0 && totalOut === 0) return null;

  const durationMs = Math.max(0, Number(endTime ?? 0) - Number(startTime ?? 0));
  const durationS = durationMs / 1000;
  const perSec = (total) => (durationS > 0 ? +(total / durationS).toFixed(2) : 0);

  return {
    metric: 'ddp_messages',
    duration_s: +durationS.toFixed(2),
    total_in: totalIn,
    total_out: totalOut,
    in_per_sec: perSec(totalIn),
    out_per_sec: perSec(totalOut),
    by_type: {
      in: { ...(by_in || {}) },
      out: { ...(by_out || {}) },
    },
  };
}
