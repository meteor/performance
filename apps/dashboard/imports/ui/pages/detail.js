import { Template } from 'meteor/templating';
import { FlowRouter } from 'meteor/ostrio:flow-router-extra';
import { Runs } from '../../api/runs';
import './detail.html';

// ── Helpers ──────────────────────────────────────────────────────────
const fmtMs = (n) => (n == null || !Number.isFinite(n)) ? '-' : n.toFixed(2);
const fmtInt = (n) => (n == null || !Number.isFinite(n)) ? '-' : Math.round(n).toString();
const fmtRate = (n) => (n == null || !Number.isFinite(n)) ? '-' : n.toFixed(2);
const fmtPctValue = (n) => (n == null || !Number.isFinite(n)) ? '-' : `${n.toFixed(1)}%`;
const fmtMb = (n) => (n == null || !Number.isFinite(n)) ? '-' : `${n.toFixed(0)} MB`;
const fmt1 = (n) => (n == null || !Number.isFinite(n)) ? '-' : n.toFixed(1);

// Cells render via {{{value}}} (raw HTML) so the <code>/<span> wrappers below
// take effect. That means any interpolated DATA must be HTML-escaped first —
// run fields (mongo namespaces, index/plugin names, tags) are machine-generated
// but still untrusted, so escape every dynamic value to prevent stored XSS.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Build a cells[] array for the metricCard tableRows partial. Each cell
// has { value, cls } so the partial can right-align numbers.
function row(...cells) {
  return { cells: cells.map((c) => (typeof c === 'object' ? c : { value: c, cls: 'text-right' })) };
}
const left = (value) => ({ value, cls: 'text-left' });
const right = (value) => ({ value, cls: 'text-right' });

function versionLabelFor(run) {
  const v = run.meteor?.version;
  if (v && v !== 'system' && v !== 'unknown') return v;
  if (run.runtime?.channel) return run.runtime.channel;
  return 'local';
}

Template.detail.onCreated(function () {
  this.autorun(() => {
    const runId = FlowRouter.getParam('id');
    if (runId) {
      this.subscribe('runs.single', runId);
      this.subscribe('runs.recent', 200);
    }
  });
});

// FlowRouter intercepts all <a> clicks as route changes — hash anchors
// would fall through silently. Capture sidebar nav-pill clicks and scroll
// to the section manually instead of relying on browser default.
Template.detail.events({
  'click a[href^="#"]'(event, template) {
    event.preventDefault();
    const id = event.currentTarget.getAttribute('href').slice(1);
    const target = template.find('#' + id);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (history.replaceState) history.replaceState(null, '', '#' + id);
    }
  },
});

// ── Section-presence flags (derived from the hasXxx leaves) ──────────
const ddpKeys = ['ddp_methods', 'ddp_subscriptions', 'live_update_propagation',
                 'ddp_messages', 'ddp_frame_size', 'ddp_compression'];
const mongoKeys = ['mongo_ops', 'mongo_pool', 'mongo_slow_queries',
                   'mongo_index_usage', 'mongo_changestream', 'mongo_wiredtiger'];
const observerKeys = ['observer_pool', 'driver_fallbacks'];
const buildKeys = ['build_profile', 'plugin_compile'];

function anyOf(metrics, keys) {
  return keys.some((k) => metrics?.[k] != null);
}

// All known metric families — used to compute "Not in this run".
const ALL_FAMILIES = [
  'ddp_methods', 'ddp_subscriptions', 'live_update_propagation',
  'ddp_messages', 'ddp_frame_size', 'ddp_compression',
  'mongo_ops', 'mongo_pool', 'mongo_slow_queries',
  'mongo_index_usage', 'mongo_changestream', 'mongo_wiredtiger',
  'observer_pool', 'driver_fallbacks',
  'build_profile', 'plugin_compile',
];

Template.detail.helpers({
  run() {
    return Runs.findOne(FlowRouter.getParam('id'));
  },
  formatDate(date) {
    if (!date) return '-';
    return new Date(date).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  },
  formatMs(ms) {
    if (!ms) return '-';
    return `${(ms / 1000).toFixed(1)}s`;
  },
  versionLabel() { return versionLabelFor(this); },
  shortSha() {
    const s = this.meteor?.sha;
    return s && s !== 'unknown' ? s.slice(0, 8) : '';
  },

  pillClass(active) {
    return active
      ? 'block pl-3 pr-2 py-1.5 border-l-2 border-indigo-500 text-neutral-950 dark:text-neutral-100 bg-neutral-100 dark:bg-neutral-800/60 rounded-r-md'
      : 'block pl-3 pr-2 py-1.5 border-l-2 border-transparent text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-900/40 rounded-r-md transition';
  },

  // ── Verdict: Δ vs predecessor run of the same scenario ──────────
  prevRunId() {
    const prev = Runs.find(
      { scenario: this.scenario, timestamp: { $lt: this.timestamp } },
      { sort: { timestamp: -1 }, limit: 1 }
    ).fetch()[0];
    return prev?._id;
  },
  verdict() {
    const prev = Runs.find(
      { scenario: this.scenario, timestamp: { $lt: this.timestamp } },
      { sort: { timestamp: -1 }, limit: 1 }
    ).fetch()[0];
    if (!prev || !prev.wall_clock_ms || !this.wall_clock_ms) return null;
    const dp = ((this.wall_clock_ms - prev.wall_clock_ms) / prev.wall_clock_ms) * 100;
    if (Math.abs(dp) < 1) return null;
    const sign = dp > 0 ? '▲' : '▼';
    const cls = Math.abs(dp) < 5
      ? 'text-neutral-500'
      : dp > 0 ? 'text-orange-500' : 'text-green-500';
    return {
      arrow: sign,
      text: `${dp > 0 ? '+' : ''}${dp.toFixed(1)}% duration vs prev (${versionLabelFor(prev)} · ${prev.tag})`,
      class: cls,
    };
  },

  // ── Section flags ───────────────────────────────────────────────
  hasDdpSection() { return anyOf(this.metrics, ddpKeys); },
  hasMongoSection() { return anyOf(this.metrics, mongoKeys); },
  hasObserverSection() { return anyOf(this.metrics, observerKeys); },
  hasBuildSection() { return anyOf(this.metrics, buildKeys); },
  hasMissingSection() {
    return ALL_FAMILIES.some((k) => this.metrics?.[k] == null);
  },
  missingMetrics() {
    return ALL_FAMILIES.filter((k) => this.metrics?.[k] == null);
  },

  // ── Overview cards ──────────────────────────────────────────────
  runInfoRows() {
    const rows = [
      { label: 'Date', value: new Date(this.timestamp).toLocaleString('en-GB', {
          day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit' }) },
      { label: 'Tag', value: `<span class="font-mono">${esc(this.tag)}</span>` },
      { label: 'Scenario', value: esc(this.scenario) },
    ];
    const v = this.meteor?.version;
    if (v && v !== 'system' && v !== 'unknown') {
      rows.push({ label: 'Meteor version', value: esc(v) });
    }
    const sha = this.meteor?.sha;
    if (sha && sha !== 'unknown') {
      rows.push({ label: 'Meteor sha', value: `<span class="font-mono text-[12px]">${esc(sha)}</span>` });
    }
    rows.push({ label: 'Duration', value: this.wall_clock_ms ? `${(this.wall_clock_ms / 1000).toFixed(2)}s` : '-' });
    if (this.source) rows.push({ label: 'Source', value: this.source });
    if (this.prNumber) rows.push({ label: 'PR', value: `#${this.prNumber}` });
    return rows;
  },

  appResourcesRows() {
    const a = this.metrics?.app_resources || {};
    return [
      { label: 'CPU avg', value: fmtPctValue(a.cpu?.avg) },
      { label: 'CPU max', value: fmtPctValue(a.cpu?.max) },
      { label: 'RAM avg', value: fmtMb(a.memory?.avg_mb) },
      { label: 'RAM max', value: fmtMb(a.memory?.max_mb) },
    ];
  },

  dbResourcesRows() {
    const a = this.metrics?.db_resources || {};
    return [
      { label: 'CPU avg', value: fmtPctValue(a.cpu?.avg) },
      { label: 'CPU max', value: fmtPctValue(a.cpu?.max) },
      { label: 'RAM avg', value: fmtMb(a.memory?.avg_mb) },
      { label: 'RAM max', value: fmtMb(a.memory?.max_mb) },
    ];
  },

  gcRows() {
    const g = this.metrics?.gc || {};
    return [
      { label: 'GC count', value: fmtInt(g.count) },
      { label: 'Total pause', value: `${fmtInt(g.total_pause_ms)} ms` },
      { label: 'Max pause', value: `${fmt1(g.max_pause_ms)} ms` },
      { label: 'Avg pause', value: `${fmt1(g.avg_pause_ms)} ms` },
      { label: 'Minor (scavenge)', value: `${fmtInt(g.minor?.count)} (${fmtInt(g.minor?.total_ms)} ms)` },
      { label: 'Major (full)', value: `${fmtInt(g.major?.count)} (${fmtInt(g.major?.total_ms)} ms)` },
    ];
  },

  // ── DDP methods ─────────────────────────────────────────────────
  hasDdpMethods() { return !!this.metrics?.ddp_methods; },
  ddpMethodsBadge() {
    const n = this.metrics?.ddp_methods?.total_calls;
    return n != null ? `${n} calls` : '';
  },
  ddpMethodsHeaders: [
    { label: 'Method', cls: 'text-left' },
    { label: 'count', cls: 'text-right' },
    { label: 'avg', cls: 'text-right' },
    { label: 'p95', cls: 'text-right' },
    { label: 'p99', cls: 'text-right' },
    { label: 'max', cls: 'text-right' },
  ],
  ddpMethodsRows() {
    const methods = this.metrics?.ddp_methods?.methods ?? {};
    return Object.entries(methods)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([name, m]) => row(
        left(`<code class="font-mono text-[12px]">${esc(name)}</code>`),
        right(fmtInt(m.count)),
        right(fmtMs(m.avg_ms)),
        right(fmtMs(m.p95)),
        right(fmtMs(m.p99)),
        right(fmtMs(m.max_ms)),
      ));
  },

  // ── DDP subscriptions ───────────────────────────────────────────
  hasDdpSubscriptions() { return !!this.metrics?.ddp_subscriptions; },
  ddpSubsBadge() {
    const n = this.metrics?.ddp_subscriptions?.total_subs;
    return n != null ? `${n} subs` : '';
  },
  ddpSubsRows() {
    const pubs = this.metrics?.ddp_subscriptions?.publications ?? {};
    return Object.entries(pubs)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([name, p]) => row(
        left(`<code class="font-mono text-[12px]">${esc(name)}</code>`),
        right(fmtInt(p.count)),
        right(fmtMs(p.avg_ms)),
        right(fmtMs(p.p95)),
        right(fmtMs(p.p99)),
        right(fmtMs(p.max_ms)),
      ));
  },

  // ── Live update propagation ─────────────────────────────────────
  hasLiveUpdatePropagation() { return !!this.metrics?.live_update_propagation; },
  lupBadge() {
    const n = this.metrics?.live_update_propagation?.observed_updates;
    return n != null ? `${fmtInt(n)} emits` : '';
  },
  lupRows() {
    const l = this.metrics?.live_update_propagation || {};
    return [
      { label: 'avg', value: `${fmtMs(l.avg_ms)} ms` },
      { label: 'p50', value: `${fmtMs(l.p50)} ms` },
      { label: 'p95', value: `${fmtMs(l.p95)} ms` },
      { label: 'p99', value: `${fmtMs(l.p99)} ms` },
      { label: 'max', value: `${fmtMs(l.max_ms)} ms` },
    ];
  },

  // ── DDP messages ────────────────────────────────────────────────
  hasDdpMessages() { return !!this.metrics?.ddp_messages; },
  ddpMsgsBadge() {
    const m = this.metrics?.ddp_messages;
    if (!m) return '';
    return `${fmt1(m.duration_s)}s · ${fmtInt(m.total_in)} in / ${fmtInt(m.total_out)} out`;
  },
  ddpMsgsRows() {
    const m = this.metrics?.ddp_messages || {};
    return [
      { label: 'incoming (client → server)', value: `${fmtInt(m.total_in)} (${fmtRate(m.in_per_sec)}/s)` },
      { label: 'outgoing (server → client)', value: `${fmtInt(m.total_out)} (${fmtRate(m.out_per_sec)}/s)` },
    ];
  },
  ddpMsgsByTypeHeaders: [
    { label: 'Type', cls: 'text-left' },
    { label: 'in',   cls: 'text-right' },
    { label: 'out',  cls: 'text-right' },
  ],
  ddpMsgsByTypeRows() {
    const inMap = this.metrics?.ddp_messages?.by_type?.in ?? {};
    const outMap = this.metrics?.ddp_messages?.by_type?.out ?? {};
    const allTypes = new Set([...Object.keys(inMap), ...Object.keys(outMap)]);
    return Array.from(allTypes)
      .map((type) => ({
        type,
        inV: inMap[type], outV: outMap[type],
        _sortKey: (inMap[type] ?? 0) + (outMap[type] ?? 0),
      }))
      .sort((a, b) => b._sortKey - a._sortKey)
      .map(({ type, inV, outV }) => row(
        left(`<code class="font-mono text-[12px]">${esc(type)}</code>`),
        right(inV != null ? fmtInt(inV) : '-'),
        right(outV != null ? fmtInt(outV) : '-'),
      ));
  },

  // ── DDP frame size ──────────────────────────────────────────────
  hasDdpFrameSize() { return !!this.metrics?.ddp_frame_size; },
  ddpFrameHeaders: [
    { label: 'Dir',   cls: 'text-left' },
    { label: 'count', cls: 'text-right' },
    { label: 'avg',   cls: 'text-right' },
    { label: 'p50',   cls: 'text-right' },
    { label: 'p95',   cls: 'text-right' },
    { label: 'p99',   cls: 'text-right' },
    { label: 'max',   cls: 'text-right' },
  ],
  ddpFrameRows() {
    const f = this.metrics?.ddp_frame_size || {};
    const dir = (d, label) => row(
      left(label),
      right(fmtInt(d?.count)),
      right(fmtInt(d?.avg_bytes)),
      right(fmtInt(d?.p50_bytes)),
      right(fmtInt(d?.p95_bytes)),
      right(fmtInt(d?.p99_bytes)),
      right(fmtInt(d?.max_bytes)),
    );
    return [dir(f.in, 'in'), dir(f.out, 'out')];
  },

  // ── DDP compression ─────────────────────────────────────────────
  hasDdpCompression() { return !!this.metrics?.ddp_compression; },
  ddpCompHeaders: [
    { label: 'Dir',         cls: 'text-left' },
    { label: 'uncompressed', cls: 'text-right' },
    { label: 'compressed',   cls: 'text-right' },
    { label: 'ratio',        cls: 'text-right' },
    { label: 'savings',      cls: 'text-right' },
  ],
  ddpCompRows() {
    const c = this.metrics?.ddp_compression || {};
    const dir = (d, label) => row(
      left(label),
      right(fmtInt(d?.uncompressed_bytes)),
      right(fmtInt(d?.compressed_bytes)),
      right(d?.ratio == null ? '-' : d.ratio.toFixed(4)),
      right(d?.savings_pct == null ? '-' : `${d.savings_pct}%`),
    );
    return [dir(c.in, 'in'), dir(c.out, 'out')];
  },

  // ── Mongo opcounters ────────────────────────────────────────────
  hasMongoOps() { return !!this.metrics?.mongo_ops; },
  mongoOpsBadge() {
    const d = this.metrics?.mongo_ops?.duration_s;
    return d != null ? `${fmt1(d)}s window` : '';
  },
  mongoOpsHeaders: [
    { label: 'Op',     cls: 'text-left' },
    { label: 'total',  cls: 'text-right' },
    { label: 'ops/sec', cls: 'text-right' },
  ],
  mongoOpsRows() {
    const totals = this.metrics?.mongo_ops?.totals ?? {};
    const rates = this.metrics?.mongo_ops?.ops_per_sec ?? {};
    return Object.keys(totals).map((op) => row(
      left(`<code class="font-mono text-[12px]">${esc(op)}</code>`),
      right(fmtInt(totals[op])),
      right(fmtRate(rates[op])),
    ));
  },

  // ── Mongo pool ──────────────────────────────────────────────────
  hasMongoPool() { return !!this.metrics?.mongo_pool; },
  mongoPoolBadge() {
    const m = this.metrics?.mongo_pool;
    return m ? `${fmtInt(m.samples)} samples @ ${fmtInt(m.interval_ms)}ms` : '';
  },
  mongoPoolHeaders: [
    { label: 'Metric', cls: 'text-left' },
    { label: 'min',    cls: 'text-right' },
    { label: 'max',    cls: 'text-right' },
    { label: 'avg',    cls: 'text-right' },
    { label: 'end',    cls: 'text-right' },
  ],
  mongoPoolRows() {
    const p = this.metrics?.mongo_pool || {};
    return [
      row(left('Current'), right(fmtInt(p.current?.min)), right(fmtInt(p.current?.max)), right(fmt1(p.current?.avg)), right(fmtInt(p.current?.end))),
      row(left('Active'),  right(fmtInt(p.active?.min)),  right(fmtInt(p.active?.max)),  right(fmt1(p.active?.avg)),  right(fmtInt(p.active?.end))),
      row(left('Total created Δ'), right(fmtInt(p.total_created?.start)), right(fmtInt(p.total_created?.end)), right(`+${fmtInt(p.total_created?.delta)}`), right('')),
    ];
  },

  // ── Mongo slow queries ──────────────────────────────────────────
  hasMongoSlowQueries() { return !!this.metrics?.mongo_slow_queries; },
  mongoSlowBadge() {
    const m = this.metrics?.mongo_slow_queries;
    return m ? `${fmtInt(m.total_slow)} slow · ≥${fmtInt(m.threshold_ms)}ms` : '';
  },
  mongoSlowHeaders: [
    { label: 'Op type', cls: 'text-left' },
    { label: 'count',   cls: 'text-right' },
  ],
  mongoSlowByOpRows() {
    const byOp = this.metrics?.mongo_slow_queries?.by_op ?? {};
    return Object.entries(byOp)
      .sort((a, b) => b[1] - a[1])
      .map(([op, count]) => row(
        left(`<code class="font-mono text-[12px]">${esc(op)}</code>`),
        right(fmtInt(count)),
      ));
  },
  mongoSlowSampleRows() {
    const s = this.metrics?.mongo_slow_queries?.slowest_sample;
    if (!s) return [];
    return [
      { label: 'slowest', value: `<code class="font-mono text-[12px]">${esc(s.ns)}</code> · ${esc(s.op)} · ${fmtInt(s.millis)} ms` },
      { label: 'filter keys', value: `<code class="font-mono text-[12px]">${esc((s.filter_keys || []).join(', ') || '(none)')}</code>` },
      { label: 'plan', value: `<code class="font-mono text-[12px]">${esc(s.planSummary || '(none)')}</code>` },
    ];
  },

  // ── Mongo index usage ───────────────────────────────────────────
  hasMongoIndexUsage() { return !!this.metrics?.mongo_index_usage; },
  mongoIndexCollections() {
    const collections = this.metrics?.mongo_index_usage?.collections ?? {};
    return Object.entries(collections).map(([collection, indexes]) => ({
      collectionTitle: `Index usage · ${collection}`,
      indexHeaders: [
        { label: 'Index',           cls: 'text-left' },
        { label: 'Key',             cls: 'text-left' },
        { label: 'ops in window',   cls: 'text-right' },
        { label: 'tracked since',   cls: 'text-right' },
      ],
      indexes: (indexes || []).map((idx) => row(
        left(`<code class="font-mono text-[12px]">${esc(idx.name)}</code>`),
        left(`<code class="font-mono text-[12px]">${esc(JSON.stringify(idx.key ?? {}))}</code>`),
        right(fmtInt(idx.ops_in_window)),
        right(`<span class="text-[10px]">${esc(idx.since || '')}</span>`),
      )),
    }));
  },

  // ── Mongo changestream ──────────────────────────────────────────
  hasMongoChangestream() { return !!this.metrics?.mongo_changestream; },
  changestreamBadge() {
    const m = this.metrics?.mongo_changestream;
    return m ? `${fmtInt(m.samples)} samples @ ${fmtInt(m.interval_ms)}ms` : '';
  },
  changestreamHeaders: [
    { label: 'Namespace', cls: 'text-left' },
    { label: 'min', cls: 'text-right' },
    { label: 'max', cls: 'text-right' },
    { label: 'avg', cls: 'text-right' },
    { label: 'end', cls: 'text-right' },
  ],
  changestreamRows() {
    const c = this.metrics?.mongo_changestream || {};
    const total = row(
      left('total cursors'),
      right(fmtInt(c.cursor_count?.min)),
      right(fmtInt(c.cursor_count?.max)),
      right(fmt1(c.cursor_count?.avg)),
      right(fmtInt(c.cursor_count?.end)),
    );
    const byNs = c.by_namespace || {};
    const nsRows = Object.entries(byNs)
      .sort((a, b) => (b[1].max ?? 0) - (a[1].max ?? 0))
      .map(([ns, v]) => row(
        left(`<code class="font-mono text-[12px]">${esc(ns)}</code>`),
        right('-'),
        right(fmtInt(v.max)),
        right(fmt1(v.avg)),
        right('-'),
      ));
    return [total, ...nsRows];
  },

  // ── Mongo WT ────────────────────────────────────────────────────
  hasMongoWiredtiger() { return !!this.metrics?.mongo_wiredtiger; },
  wtBadge() {
    const v = this.metrics?.mongo_wiredtiger?.cache_hit_ratio;
    return v == null ? '' : `hit ratio ${(v * 100).toFixed(1)}%`;
  },
  wtRows() {
    const w = this.metrics?.mongo_wiredtiger || {};
    const mb = w.bytes_in_cache_end != null
      ? `${(w.bytes_in_cache_end / 1024 / 1024).toFixed(1)} MB` : '-';
    return [
      { label: 'cache hit ratio', value: w.cache_hit_ratio == null ? '-' : w.cache_hit_ratio.toFixed(4) },
      { label: 'pages requested', value: fmtInt(w.pages_requested_in_window) },
      { label: 'pages read into cache', value: fmtInt(w.pages_read_into_cache) },
      { label: 'pages written from cache', value: fmtInt(w.pages_written_from_cache) },
      { label: 'bytes in cache (end)', value: mb },
    ];
  },

  // ── Observer pool ───────────────────────────────────────────────
  hasObserverPool() { return !!this.metrics?.observer_pool; },
  observerPoolBadge() {
    const o = this.metrics?.observer_pool;
    return o ? `${fmtInt(o.samples)} samples @ ${fmtInt(o.interval_ms)}ms` : '';
  },
  observerPoolHeaders: [
    { label: 'Metric', cls: 'text-left' },
    { label: 'min',    cls: 'text-right' },
    { label: 'max',    cls: 'text-right' },
    { label: 'avg',    cls: 'text-right' },
    { label: 'end',    cls: 'text-right' },
  ],
  observerPoolRows() {
    const o = this.metrics?.observer_pool || {};
    return [
      row(left('Multiplexers'),
        right(fmtInt(o.multiplexer_count?.min)),
        right(fmtInt(o.multiplexer_count?.max)),
        right(fmt1(o.multiplexer_count?.avg)),
        right(fmtInt(o.multiplexer_count?.end)),
      ),
      row(left('Handles'),
        right(fmtInt(o.handle_count?.min)),
        right(fmtInt(o.handle_count?.max)),
        right(fmt1(o.handle_count?.avg)),
        right(fmtInt(o.handle_count?.end)),
      ),
    ];
  },

  // ── Driver fallbacks ────────────────────────────────────────────
  hasDriverFallbacks() { return !!this.metrics?.driver_fallbacks; },
  driverBadge() {
    const v = this.metrics?.driver_fallbacks?.configured_first;
    return v != null ? `${v} configured` : '';
  },
  driverRows() {
    const d = this.metrics?.driver_fallbacks || {};
    const t = d.total_cursors ?? 0;
    const nf = d.no_fallback ?? 0;
    return [
      { label: 'total observe() calls', value: fmtInt(t) },
      { label: 'no fallback', value: fmtInt(nf) },
      { label: 'fell back', value: fmtInt(t - nf) },
    ];
  },
  driverFallbackHeaders: [
    { label: 'Transition', cls: 'text-left' },
    { label: 'cursors',    cls: 'text-right' },
  ],
  driverFallbackRows() {
    const f = this.metrics?.driver_fallbacks?.fallbacks ?? {};
    return Object.entries(f)
      .sort((a, b) => b[1] - a[1])
      .map(([transition, count]) => row(
        left(`<code class="font-mono text-[12px]">${esc(transition)}</code>`),
        right(fmtInt(count)),
      ));
  },

  // ── Build profile ───────────────────────────────────────────────
  hasBuildProfile() { return !!this.metrics?.build_profile; },
  buildBadge() {
    const m = this.metrics?.build_profile;
    return m ? `total ${fmtInt(m.total_ms)} ms` : '';
  },
  buildFooter() {
    const b = this.metrics?.build_profile;
    if (!b) return '';
    return `top ${fmtInt(b.top_n_count)} = ${fmtInt(b.top_n_total_ms)} ms · long tail = ${fmtInt(b.long_tail_ms)} ms`;
  },
  buildHeaders: [
    { label: 'Node',        cls: 'text-left' },
    { label: 'self ms',     cls: 'text-right' },
    { label: 'children ms', cls: 'text-right' },
    { label: 'count',       cls: 'text-right' },
  ],
  buildTopNodes() {
    return (this.metrics?.build_profile?.top_nodes ?? []).map((n) => row(
      left(`<code class="font-mono text-[12px]">${esc(n.name)}</code>`),
      right(fmtInt(n.self_ms)),
      right(fmtInt(n.children_ms)),
      right(fmtInt(n.count)),
    ));
  },

  // ── Per-plugin compile ──────────────────────────────────────────
  hasPluginCompile() { return !!this.metrics?.plugin_compile; },
  pluginBadge() {
    const p = this.metrics?.plugin_compile;
    if (!p) return '';
    const n = p.plugins ? Object.keys(p.plugins).length : 0;
    return `${fmtInt(p.total_plugin_ms)} ms across ${n} plugins`;
  },
  pluginHeaders: [
    { label: 'Plugin',  cls: 'text-left' },
    { label: 'self ms', cls: 'text-right' },
    { label: 'count',   cls: 'text-right' },
  ],
  pluginRows() {
    const plugins = this.metrics?.plugin_compile?.plugins ?? {};
    return Object.entries(plugins)
      .sort((a, b) => (b[1].self_ms ?? 0) - (a[1].self_ms ?? 0))
      .map(([plugin, v]) => row(
        left(`<code class="font-mono text-[12px]">${esc(plugin)}</code>`),
        right(fmtInt(v.self_ms)),
        right(fmtInt(v.count)),
      ));
  },
});
