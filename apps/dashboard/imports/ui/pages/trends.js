import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';
import { FlowRouter } from 'meteor/ostrio:flow-router-extra';
import { Meteor } from 'meteor/meteor';
import { Chart } from 'chart.js/auto';
import 'chartjs-adapter-date-fns';
import { Runs } from '../../api/runs';
import './trends.html';

// Brand-aligned palette: indigo / green / orange / teal / pink. Cycled
// by segment index so version A is always the same color regardless of
// metric or date range.
const PALETTE = ['#6366F1', '#22C55E', '#F97316', '#67CDCC', '#FF79C6', '#A78BFA', '#FBBF24'];

// One entry per metric option — get(run) returns a numeric Y value.
const METRIC_EXTRACTORS = {
  wall_clock: (r) => r.wall_clock_ms / 1000,
  cpu_avg:    (r) => r.metrics?.app_resources?.cpu?.avg,
  cpu_max:    (r) => r.metrics?.app_resources?.cpu?.max,
  ram_avg:    (r) => r.metrics?.app_resources?.memory?.avg_mb,
  ram_max:    (r) => r.metrics?.app_resources?.memory?.max_mb,
  gc_total:   (r) => r.metrics?.gc?.total_pause_ms,
  gc_max:     (r) => r.metrics?.gc?.max_pause_ms,
  gc_count:   (r) => r.metrics?.gc?.count,
  ddp_methods_total: (r) => r.metrics?.ddp_methods?.total_calls,
  ddp_subs_total:    (r) => r.metrics?.ddp_subscriptions?.total_subs,
  live_update_p95:   (r) => r.metrics?.live_update_propagation?.p95,
  ddp_msgs_out:      (r) => r.metrics?.ddp_messages?.total_out,
  mongo_ops_total:   (r) => {
    const t = r.metrics?.mongo_ops?.totals;
    return t ? Object.values(t).reduce((a, b) => a + b, 0) : null;
  },
  mongo_pool_max: (r) => r.metrics?.mongo_pool?.current?.max,
  build_total:    (r) => r.metrics?.build_profile?.total_ms,
  plugin_total:   (r) => r.metrics?.plugin_compile?.total_plugin_ms,
};

function versionOf(run) {
  const v = run.meteor?.version;
  if (v && v !== 'system' && v !== 'unknown') return v;
  if (run.runtime?.channel) return run.runtime.channel;
  return 'local';
}

Template.trends.onCreated(function () {
  this.scenarios = new ReactiveVar([]);
  this.selectedScenario = new ReactiveVar('');
  this.selectedMetric = new ReactiveVar('wall_clock');
  this.segmentBy = new ReactiveVar('version');
  this.rangeDays = new ReactiveVar(30);
  this.chartStats = new ReactiveVar({ runs: 0, segments: [] });
  this.chart = null;

  Meteor.callAsync('runs.distinctScenarios').then((s) => {
    this.scenarios.set(s);
    if (s.length > 0 && !this.selectedScenario.get()) {
      this.selectedScenario.set(s[0]);
    }
  });

  this.subscribe('runs.recent', 500);
});

Template.trends.onRendered(function () {
  this.autorun(() => {
    const scenario = this.selectedScenario.get();
    const metric = this.selectedMetric.get();
    const segmentBy = this.segmentBy.get();
    const rangeDays = this.rangeDays.get();
    if (!scenario) return;

    const since = rangeDays > 0 ? new Date(Date.now() - rangeDays * 86400 * 1000) : null;
    const query = { scenario };
    if (since) query.timestamp = { $gte: since };
    const runs = Runs.find(query, { sort: { timestamp: 1 } }).fetch();

    const extractor = METRIC_EXTRACTORS[metric];
    const canvas = this.find('#trendChart');
    if (!canvas || !extractor || runs.length === 0) {
      if (this.chart) { this.chart.destroy(); this.chart = null; }
      return;
    }

    // Group runs by segment key (version or tag), preserving the
    // chronological order of first-appearance so colors stay stable
    // across re-renders.
    const segments = new Map();
    for (const r of runs) {
      const key = segmentBy === 'version' ? versionOf(r) : r.tag;
      if (!segments.has(key)) segments.set(key, []);
      const y = extractor(r);
      if (y != null && Number.isFinite(y)) {
        segments.get(key).push({ x: new Date(r.timestamp), y, runId: r._id });
      }
    }

    // Boundary annotations (only on version mode) — mark when a new
    // version first appears.
    const versionBoundaries = [];
    if (segmentBy === 'version') {
      const seen = new Set();
      for (const r of runs) {
        const v = versionOf(r);
        if (!seen.has(v)) {
          seen.add(v);
          versionBoundaries.push({ x: new Date(r.timestamp), label: v });
        }
      }
    }

    const datasets = [...segments.entries()].map(([key, points], i) => ({
      label: key,
      data: points,
      borderColor: PALETTE[i % PALETTE.length],
      backgroundColor: PALETTE[i % PALETTE.length] + '20',
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.25,
      fill: false,
    }));

    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? 'rgba(64,64,64,0.4)' : 'rgba(229,229,229,0.8)';
    const tickColor = isDark ? '#929090' : '#737373';

    if (this.chart) this.chart.destroy();
    this.chart = new Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
          x: {
            type: 'time',
            time: { unit: rangeDays <= 7 ? 'hour' : 'day' },
            grid: { color: gridColor },
            ticks: { color: tickColor, font: { family: 'JetBrains Mono' } },
          },
          y: {
            beginAtZero: true,
            grid: { color: gridColor },
            ticks: { color: tickColor, font: { family: 'JetBrains Mono' } },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: { mode: 'nearest', intersect: false },
          annotation: {},
        },
        onClick: (event, elements) => {
          if (!elements.length) return;
          const { datasetIndex, index } = elements[0];
          const point = datasets[datasetIndex].data[index];
          if (point?.runId) FlowRouter.go(`/run/${point.runId}`);
        },
      },
      // Plugin to draw vertical boundary lines for version transitions.
      plugins: versionBoundaries.length ? [{
        id: 'versionBoundaries',
        afterDraw(chart) {
          const { ctx, chartArea, scales: { x } } = chart;
          ctx.save();
          ctx.strokeStyle = isDark ? 'rgba(99,102,241,0.35)' : 'rgba(99,102,241,0.5)';
          ctx.setLineDash([3, 3]);
          ctx.fillStyle = isDark ? '#6366F1' : '#4F46E5';
          ctx.font = '10px JetBrains Mono';
          for (const b of versionBoundaries) {
            const px = x.getPixelForValue(b.x.getTime());
            if (px < chartArea.left || px > chartArea.right) continue;
            ctx.beginPath();
            ctx.moveTo(px, chartArea.top);
            ctx.lineTo(px, chartArea.bottom);
            ctx.stroke();
            ctx.fillText(`${b.label} →`, px + 4, chartArea.top + 10);
          }
          ctx.restore();
        },
      }] : [],
    });

    // Stash dataset shape into a ReactiveVar so the legend + counter
    // helpers re-render reactively.
    this.chartStats.set({
      runs: runs.length,
      segments: [...segments.entries()].map(([key, pts], i) => ({
        label: key, count: pts.length, color: PALETTE[i % PALETTE.length],
      })),
    });
  });
});

Template.trends.onDestroyed(function () {
  if (this.chart) this.chart.destroy();
});

Template.trends.helpers({
  scenarios() { return Template.instance().scenarios.get(); },
  segClass(name) {
    const active = Template.instance().segmentBy.get() === name;
    return active
      ? 'px-3 py-1.5 bg-indigo-500 text-white'
      : 'px-3 py-1.5 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition';
  },
  hasData() {
    const t = Template.instance();
    return t.selectedScenario.get() && Runs.find({ scenario: t.selectedScenario.get() }).count() > 0;
  },
  canvasVisibility() {
    const t = Template.instance();
    return t.selectedScenario.get() && Runs.find({ scenario: t.selectedScenario.get() }).count() > 0
      ? 'block' : 'hidden';
  },
  runCount() {
    return Template.instance().chartStats.get().runs;
  },
  segmentCount() {
    return Template.instance().chartStats.get().segments.length;
  },
  segmentNoun() {
    return Template.instance().segmentBy.get() === 'version' ? 'versions' : 'tags';
  },
  legendEntries() {
    return Template.instance().chartStats.get().segments;
  },
});

Template.trends.events({
  'change #trendScenario'(event, instance) {
    instance.selectedScenario.set(event.target.value);
  },
  'change #trendMetric'(event, instance) {
    instance.selectedMetric.set(event.target.value);
  },
  'change #trendRange'(event, instance) {
    instance.rangeDays.set(Number(event.target.value));
  },
  'click #segVersion'(event, instance) { instance.segmentBy.set('version'); },
  'click #segTag'(event, instance)     { instance.segmentBy.set('tag'); },
});
