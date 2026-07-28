// Pure pass-through aggregator for the driver-fallback tracker — the
// in-app monitor already computed total / no_fallback / fallbacks (it's
// just counters, no percentile math), so this aggregator's job is mostly
// shape validation + the absence convention.
//
// Returns null when no observes were recorded (CC-5: collector ran but
// nothing happened → caller omits the key entirely).

export function aggregateDriverFallback(dump) {
  const total = Number(dump?.total_cursors) || 0;
  if (total === 0) return null;
  const noFallback = Number(dump?.no_fallback) || 0;
  return {
    metric: 'driver_fallbacks',
    total_cursors: total,
    no_fallback: noFallback,
    configured_first: dump?.configured_first ?? null,
    fallbacks: { ...(dump?.fallbacks || {}) },
  };
}
