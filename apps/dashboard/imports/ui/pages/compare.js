import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';
import { ReactiveDict } from 'meteor/reactive-dict';
import { Meteor } from 'meteor/meteor';
import { Runs } from '../../api/runs';
import './compare.html';

// ── Metric extractors ─────────────────────────────────────────────────
// Each entry is { key, label, unit, get(run), drilldown(run) }. Adding a
// new comparable metric = add an entry. drilldown is optional and gives
// the per-row expand contents (e.g. ddp_methods per-method, mongo_ops
// per-op).
//
// Unit: 'ms' / 'pct' / 'mb' / 'count' / 'bytes' — used to format display
// and decide whether the metric is "lower is better".

const M = [
  { key: 'wall_clock', label: 'duration', unit: 'ms',
    get: (r) => r.wall_clock_ms },
  { key: 'app_cpu.avg', unit: 'pct',
    get: (r) => r.metrics?.app_resources?.cpu?.avg },
  { key: 'app_cpu.max', unit: 'pct',
    get: (r) => r.metrics?.app_resources?.cpu?.max },
  { key: 'app_mem.avg', unit: 'mb',
    get: (r) => r.metrics?.app_resources?.memory?.avg_mb },
  { key: 'app_mem.max', unit: 'mb',
    get: (r) => r.metrics?.app_resources?.memory?.max_mb },
  { key: 'db_cpu.avg', unit: 'pct',
    get: (r) => r.metrics?.db_resources?.cpu?.avg },
  { key: 'db_mem.avg', unit: 'mb',
    get: (r) => r.metrics?.db_resources?.memory?.avg_mb },
  { key: 'gc.total_pause', unit: 'ms',
    get: (r) => r.metrics?.gc?.total_pause_ms },
  { key: 'gc.max_pause', unit: 'ms',
    get: (r) => r.metrics?.gc?.max_pause_ms },
  { key: 'gc.count', unit: 'count',
    get: (r) => r.metrics?.gc?.count },
  { key: 'gc.major.total_ms', unit: 'ms',
    get: (r) => r.metrics?.gc?.major?.total_ms },

  { key: 'ddp_methods.total_calls', unit: 'count',
    get: (r) => r.metrics?.ddp_methods?.total_calls,
    drilldown: (r) => r.metrics?.ddp_methods?.methods },
  { key: 'ddp_methods.avg', unit: 'ms',
    get: (r) => {
      const ms = r.metrics?.ddp_methods?.methods;
      if (!ms) return null;
      const vals = Object.values(ms).map((m) => m.avg_ms).filter((v) => v != null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    } },
  { key: 'ddp_subs.total_subs', unit: 'count',
    get: (r) => r.metrics?.ddp_subscriptions?.total_subs,
    drilldown: (r) => r.metrics?.ddp_subscriptions?.publications },

  { key: 'live_update.p95', unit: 'ms',
    get: (r) => r.metrics?.live_update_propagation?.p95 },
  { key: 'live_update.avg', unit: 'ms',
    get: (r) => r.metrics?.live_update_propagation?.avg_ms },
  { key: 'live_update.max', unit: 'ms',
    get: (r) => r.metrics?.live_update_propagation?.max_ms },

  { key: 'mongo_ops.total', unit: 'count',
    get: (r) => {
      const t = r.metrics?.mongo_ops?.totals;
      return t ? Object.values(t).reduce((a, b) => a + b, 0) : null;
    },
    drilldown: (r) => r.metrics?.mongo_ops?.totals },

  { key: 'ddp_messages.total_out', unit: 'count',
    get: (r) => r.metrics?.ddp_messages?.total_out },
  { key: 'ddp_messages.out_per_sec', unit: 'count',
    get: (r) => r.metrics?.ddp_messages?.out_per_sec },

  { key: 'mongo_pool.current.max', unit: 'count',
    get: (r) => r.metrics?.mongo_pool?.current?.max },

  { key: 'build_profile.total', unit: 'ms',
    get: (r) => r.metrics?.build_profile?.total_ms },
  { key: 'plugin_compile.total', unit: 'ms',
    get: (r) => r.metrics?.plugin_compile?.total_plugin_ms },
];

function fmt(value, unit) {
  if (value == null || !Number.isFinite(value)) return '-';
  switch (unit) {
    case 'ms':
      if (value >= 10000) return `${(value / 1000).toFixed(1)}s`;
      return `${value.toFixed(value < 1 ? 2 : 1)} ms`;
    case 'pct':  return `${value.toFixed(1)}%`;
    case 'mb':   return `${value.toFixed(0)} MB`;
    case 'count': return Math.round(value).toLocaleString();
    case 'bytes': return `${Math.round(value).toLocaleString()} B`;
    default:     return String(value);
  }
}

function pctDelta(a, b) {
  if (a == null || b == null || a === 0) return null;
  return ((b - a) / a) * 100;
}

// Hardcoded threshold bands per brief: < 5% neutral, < 25% warn,
// ≥ 25% regression. "regression" is unit-aware — for metrics where
// higher = worse (wall, mem, latency), positive Δ = regression. For
// count-style metrics the sign is informational, not graded — clamp to
// "warn" tier at most.
function classify(deltaPct, unit) {
  if (deltaPct == null) return { tier: 'neutral', kind: 'neutral' };
  const abs = Math.abs(deltaPct);
  let tier;
  if (abs < 5) tier = 'neutral';
  else if (abs < 25) tier = 'warn';
  else tier = 'big';

  const higherIsWorse = unit === 'ms' || unit === 'mb' || unit === 'pct' || unit === 'bytes';
  const kind = !higherIsWorse
    ? (tier === 'neutral' ? 'neutral' : 'info')
    : tier === 'neutral'
      ? 'neutral'
      : deltaPct > 0
        ? (tier === 'big' ? 'regression' : 'warn')
        : 'improvement';
  return { tier, kind };
}

const STATUS_STYLES = {
  regression:  { label: 'regression',  cell: 'text-orange-500 font-medium',
                 pill: 'bg-orange-500/15 text-orange-500' },
  improvement: { label: 'improvement', cell: 'text-green-500 font-medium',
                 pill: 'bg-green-500/15 text-green-500' },
  warn:        { label: 'warn',        cell: 'text-orange-400',
                 pill: 'bg-orange-500/10 text-orange-400' },
  info:        { label: 'info',        cell: 'text-indigo-400',
                 pill: 'bg-indigo-500/10 text-indigo-400' },
  neutral:     { label: 'within noise', cell: 'text-neutral-500',
                 pill: 'bg-neutral-200 dark:bg-neutral-800 text-neutral-500' },
};

function whenAgo(ts) {
  if (!ts) return '';
  const d = ts instanceof Date ? ts : new Date(ts);
  const diff = Date.now() - d.getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function runOptionLabel(r) {
  const v = r.meteor?.version && r.meteor.version !== 'system' ? r.meteor.version : 'local';
  return `${v} · ${r.tag} · ${r.scenario} · ${whenAgo(r.timestamp)}`;
}

function runShortLabel(r) {
  const v = r.meteor?.version && r.meteor.version !== 'system' ? r.meteor.version : 'local';
  return `${v} · ${r.tag}`;
}

Template.compare.onCreated(function () {
  this.scenarios = new ReactiveVar([]);
  this.selectedScenario = new ReactiveVar('');
  this.selectedA = new ReactiveVar('');
  this.selectedB = new ReactiveVar('');
  this.hideNoise = new ReactiveVar(false);
  this.expanded = new ReactiveDict();

  this.subscribe('runs.recent', 200);
  Meteor.callAsync('runs.distinctScenarios').then((s) => this.scenarios.set(s));
});

Template.compare.helpers({
  scenarios() { return Template.instance().scenarios.get(); },
  selectedScenario() { return Template.instance().selectedScenario.get(); },
  selectedA() { return Template.instance().selectedA.get(); },
  selectedB() { return Template.instance().selectedB.get(); },
  hideNoise() { return Template.instance().hideNoise.get(); },
  isSelected(id, sel) { return id === sel; },

  runOptions() {
    const t = Template.instance();
    const sc = t.selectedScenario.get();
    const q = sc ? { scenario: sc } : {};
    return Runs.find(q, { sort: { timestamp: -1 } }).fetch().map((r) => ({
      _id: r._id,
      label: runOptionLabel(r),
    }));
  },

  bothPicked() {
    const t = Template.instance();
    return t.selectedA.get() && t.selectedB.get();
  },

  runALabel() {
    const r = Runs.findOne(Template.instance().selectedA.get());
    return r ? runShortLabel(r) : '';
  },
  runBLabel() {
    const r = Runs.findOne(Template.instance().selectedB.get());
    return r ? runShortLabel(r) : '';
  },

  summary() {
    const rows = computeRows(Template.instance());
    let regressions = 0, improvements = 0, neutral = 0;
    for (const r of rows) {
      if (r._kind === 'regression') regressions += 1;
      else if (r._kind === 'improvement') improvements += 1;
      else neutral += 1;
    }
    return { total: rows.length, regressions, improvements, neutral };
  },

  comparisonRows() {
    const t = Template.instance();
    const rows = computeRows(t);
    const hide = t.hideNoise.get();
    const filtered = hide ? rows.filter((r) => r._kind !== 'neutral') : rows;

    const a = Runs.findOne(t.selectedA.get());
    const b = Runs.findOne(t.selectedB.get());
    return filtered.map((row) => {
      const isExpanded = t.expanded.get(row.key);
      let drilldownRows = [];
      if (isExpanded) {
        const def = M.find((m) => m.key === row.key);
        if (def?.drilldown) {
          const da = def.drilldown(a) || {};
          const db = def.drilldown(b) || {};
          const keys = Array.from(new Set([...Object.keys(da), ...Object.keys(db)]));
          drilldownRows = keys.map((k) => {
            const av = typeof da[k] === 'object' ? (da[k].avg_ms ?? da[k].count) : da[k];
            const bv = typeof db[k] === 'object' ? (db[k].avg_ms ?? db[k].count) : db[k];
            const dp = pctDelta(av, bv);
            const cls = classify(dp, def.unit);
            return {
              subKey: k,
              aDisplay: fmt(av, def.unit),
              bDisplay: fmt(bv, def.unit),
              deltaPct: dp == null ? '—' : `${dp > 0 ? '+' : ''}${dp.toFixed(1)}%`,
              deltaClass: STATUS_STYLES[cls.kind].cell,
            };
          }).sort((x, y) => {
            const px = parseFloat(x.deltaPct) || 0;
            const py = parseFloat(y.deltaPct) || 0;
            return Math.abs(py) - Math.abs(px);
          });
        }
      }
      const styles = STATUS_STYLES[row._kind];
      return {
        key: row.key,
        aDisplay: row.aDisplay,
        bDisplay: row.bDisplay,
        deltaAbs: row.deltaAbs,
        deltaPct: row.deltaPct,
        deltaClass: styles.cell,
        statusClass: styles.pill,
        statusLabel: styles.label,
        aId: t.selectedA.get(),
        bId: t.selectedB.get(),
        expanded: isExpanded,
        toggleArrow: isExpanded ? '▾' : '▸',
        drilldownRows,
      };
    });
  },

  onlyInOneCount() {
    const t = Template.instance();
    const a = Runs.findOne(t.selectedA.get());
    const b = Runs.findOne(t.selectedB.get());
    if (!a || !b) return 0;
    return computeOnlyInOne(a, b).length;
  },
  onlyInOneText() {
    const t = Template.instance();
    const a = Runs.findOne(t.selectedA.get());
    const b = Runs.findOne(t.selectedB.get());
    if (!a || !b) return '';
    return computeOnlyInOne(a, b).join(' · ');
  },
});

function computeRows(instance) {
  const a = Runs.findOne(instance.selectedA.get());
  const b = Runs.findOne(instance.selectedB.get());
  if (!a || !b) return [];
  const out = [];
  for (const def of M) {
    const av = def.get(a);
    const bv = def.get(b);
    if (av == null && bv == null) continue;
    if (av == null || bv == null) continue; // belongs in "only in one"
    const dp = pctDelta(av, bv);
    const cls = classify(dp, def.unit);
    out.push({
      key: def.key,
      aDisplay: fmt(av, def.unit),
      bDisplay: fmt(bv, def.unit),
      deltaAbs: fmt(bv - av, def.unit),
      deltaPct: dp == null ? '—' : `${dp > 0 ? '+' : ''}${dp.toFixed(1)}%`,
      _absPct: dp == null ? 0 : Math.abs(dp),
      _kind: cls.kind,
    });
  }
  return out.sort((x, y) => y._absPct - x._absPct);
}

function computeOnlyInOne(a, b) {
  const out = [];
  for (const def of M) {
    const av = def.get(a);
    const bv = def.get(b);
    if (av != null && bv == null) out.push(`${def.key} (only in A)`);
    else if (av == null && bv != null) out.push(`${def.key} (only in B)`);
  }
  return out;
}

Template.compare.events({
  'change #filterScenario'(event, instance) {
    instance.selectedScenario.set(event.target.value);
    instance.selectedA.set('');
    instance.selectedB.set('');
  },
  'change #runA'(event, instance) {
    instance.selectedA.set(event.target.value);
  },
  'change #runB'(event, instance) {
    instance.selectedB.set(event.target.value);
  },
  'click #swapAB'(event, instance) {
    const a = instance.selectedA.get();
    const b = instance.selectedB.get();
    instance.selectedA.set(b);
    instance.selectedB.set(a);
  },
  'change #hideNoise'(event, instance) {
    instance.hideNoise.set(event.target.checked);
  },
  'click .js-row-toggle'(event, instance) {
    const key = event.currentTarget.dataset.key;
    instance.expanded.set(key, !instance.expanded.get(key));
  },
});
