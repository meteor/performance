// Pure ratio math for the ddp-compression collector — combines the
// frame-size monitor's pre-compression byte sums with the compression-
// tracker's post-compression socket totals to compute the per-direction
// ratio + savings %.
//
// Input: two dumps, both nullable:
//   frameSize = { in_sizes:[], out_sizes:[], by_type_in_sum:{}, by_type_out_sum:{} }
//   compression = { compressed_bytes_in, compressed_bytes_out, ... }
// Output: the `metrics.ddp_compression` shape per the task 09 spec.
//
// Returns null when EITHER side is missing (CC-5 absence: can't compute
// a ratio without both halves, so caller omits the key entirely).
//
// Numerics:
//   - ratio = compressed / uncompressed (∈ (0, ∞); pass through honestly,
//     even when >1 from WS framing overhead on tiny messages)
//   - savings_pct = (1 - ratio) * 100, rounded to 1 decimal
//   - if uncompressed is 0 in a direction, that direction's ratio +
//     savings_pct are null (divide-by-zero, per the README absence
//     convention for ratios)

function sumArray(arr) {
  if (!Array.isArray(arr)) return 0;
  let total = 0;
  for (const v of arr) total += Number(v) || 0;
  return total;
}

function directionStats(uncompressed, compressed) {
  const u = Number(uncompressed) || 0;
  const c = Number(compressed) || 0;
  if (u <= 0) {
    return {
      uncompressed_bytes: u,
      compressed_bytes: c,
      ratio: null,
      savings_pct: null,
    };
  }
  // Suspicious-zero guard: if we saw real uncompressed traffic but ZERO
  // compressed bytes, the socket-byte capture failed (compression-tracker
  // couldn't resolve the underlying TCP socket — known fragility on some
  // Meteor + transport combinations). Don't emit a nonsense "100% savings"
  // — flag as unmeasured via null ratio/savings_pct. Real compression
  // never reduces a byte stream to zero, so this is unambiguous.
  if (c <= 0) {
    return {
      uncompressed_bytes: u,
      compressed_bytes: c,
      ratio: null,
      savings_pct: null,
    };
  }
  const ratio = +(c / u).toFixed(4);
  const savingsPct = +((1 - c / u) * 100).toFixed(1);
  return {
    uncompressed_bytes: u,
    compressed_bytes: c,
    ratio,
    savings_pct: savingsPct,
  };
}

export function aggregateCompression({ frameSize, compression } = {}) {
  if (!frameSize || !compression) return null;
  const outUncompressed = sumArray(frameSize.out_sizes);
  const inUncompressed = sumArray(frameSize.in_sizes);
  const outCompressed = Number(compression.compressed_bytes_out) || 0;
  const inCompressed = Number(compression.compressed_bytes_in) || 0;

  // If neither direction moved any bytes either way, the run produced no
  // signal — omit the metric entirely.
  if (outUncompressed === 0 && inUncompressed === 0 && outCompressed === 0 && inCompressed === 0) {
    return null;
  }

  return {
    metric: 'ddp_compression',
    out: directionStats(outUncompressed, outCompressed),
    in: directionStats(inUncompressed, inCompressed),
  };
}
