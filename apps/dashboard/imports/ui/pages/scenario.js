import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';
import { FlowRouter } from 'meteor/ostrio:flow-router-extra';
import { Runs } from '../../api/runs.js';
import './scenario.html';

// Static per-scenario metadata. Same content as the v1 file (it didn't
// change), just the markup that wraps it did.
const SCENARIOS = {
  'reactive-light': {
    name: 'reactive-light',
    driver: 'Artillery + Playwright',
    vus: '30 browser sessions',
    duration: '~2 min',
    browser: true,
    summary:
      'Simulates 30 real users interacting with the app through a browser. ' +
      'Each user subscribes to a publication, adds 20 tasks, then removes them. ' +
      'Measures how the server handles reactive data flow under light load.',
    technical:
      'Artillery spawns 30 Chromium instances via Playwright. Each virtual user opens ' +
      '<code class="font-mono text-[12px]">http://localhost:3000</code>, subscribes to the ' +
      '<code class="font-mono text-[12px]">fetchTasks</code> publication, and performs 20 ' +
      '<code class="font-mono text-[12px]">insertTask</code> + 20 ' +
      '<code class="font-mono text-[12px]">removeTask</code> method calls through the UI. ' +
      'Every insert/remove triggers a reactive update across all subscribed clients via the Meteor ' +
      'oplog tailing pipeline. Collectors track server-side CPU/RAM (pidusage, 1s interval) and ' +
      'GC events (Node.js PerformanceObserver on the Meteor process). ' +
      'The browser overhead (Chromium rendering, DOM updates) is included in wall clock time.',
  },
  'reactive-crud': {
    name: 'reactive-crud',
    driver: 'Artillery + Playwright',
    vus: '240 browser sessions',
    duration: '~5 min',
    browser: true,
    summary:
      'Heavy-load version of reactive-light. 240 real browser sessions performing CRUD operations ' +
      'simultaneously. Tests how the server handles reactive pub/sub at scale.',
    technical:
      'Same flow as <code class="font-mono text-[12px]">reactive-light</code> but with 240 concurrent Chromium instances. ' +
      'This creates significant pressure on the oplog tailing pipeline, DDP message serialization, ' +
      'and MongoDB write throughput. Each mutation fans out reactive updates to all 240 subscribed clients. ' +
      'Requires substantial resources — expect high CPU and memory on the runner. ' +
      'Best run on a dedicated machine for reliable results.',
  },
  'non-reactive-crud': {
    name: 'non-reactive-crud',
    driver: 'Artillery + Playwright',
    vus: '240 browser sessions',
    duration: '~5 min',
    browser: true,
    summary:
      'Same as reactive-crud but without pub/sub. Users call methods directly without subscribing. ' +
      'Isolates pure method call + MongoDB performance from reactive overhead.',
    technical:
      '240 Chromium instances calling <code class="font-mono text-[12px]">insertTask</code> and ' +
      '<code class="font-mono text-[12px]">removeTask</code> methods without subscribing to ' +
      '<code class="font-mono text-[12px]">fetchTasks</code>. Since no publication is active, the server ' +
      'skips the oplog tailing and DDP reactive pipeline entirely. Comparing this with ' +
      '<code class="font-mono text-[12px]">reactive-crud</code> reveals the exact cost of reactivity.',
  },
  'ddp-reactive-light': {
    name: 'ddp-reactive-light',
    driver: 'Artillery + SimpleDDP',
    vus: '150 DDP connections',
    duration: '~30s',
    browser: false,
    summary:
      'Pure server benchmark — no browser involved. 150 DDP clients connect via WebSocket, ' +
      'subscribe to a publication, insert and remove 20 tasks each. ' +
      'Tests raw DDP/pub-sub performance without any rendering overhead.',
    technical:
      'Artillery spawns 150 virtual users, each creating a SimpleDDP connection over raw WebSocket ' +
      '(<code class="font-mono text-[12px]">ws</code> library). Each VU calls ' +
      '<code class="font-mono text-[12px]">ddp.subscribe("fetchTasks")</code>, then performs 20 sequential ' +
      '<code class="font-mono text-[12px]">insertTask</code> + 20 ' +
      '<code class="font-mono text-[12px]">removeTask</code> method calls. ' +
      'Reactive updates flow through the oplog tailing pipeline and are sent to all subscribed clients ' +
      'as DDP <code class="font-mono text-[12px]">changed</code>/<code class="font-mono text-[12px]">added</code>/' +
      '<code class="font-mono text-[12px]">removed</code> messages. ' +
      'No Chromium process, no DOM — measures pure Meteor server + MongoDB + DDP transport performance. ' +
      'Much faster to run than browser scenarios and scales to higher VU counts.',
  },
  'ddp-reactive-extended': {
    name: 'ddp-reactive-extended',
    driver: 'Artillery + SimpleDDP',
    vus: 'up to 10 new DDP conns/s',
    duration: '~7 min',
    browser: false,
    summary:
      'Extended sustained version of ddp-reactive-light, sized for a capable machine. ' +
      'Warms up, ramps, then holds a moderate-high reactive DDP load for 6 minutes — long ' +
      'enough to surface steady-state behavior without dropping connections. Used for the ' +
      'observer-driver × transport matrix (oplog / polling / changeStreams × sockjs / uws).',
    technical:
      'Artillery drives raw SimpleDDP WebSocket clients through three phases: 2 VU/s warm up (30s), ' +
      '5 VU/s ramp (30s), then 10 VU/s sustained (360s). Each VU subscribes to ' +
      '<code class="font-mono text-[12px]">fetchTasks</code> and performs insert/remove cycles, ' +
      'so reactive updates fan out to all subscribers through the configured observe driver. ' +
      'Because DDP sessions are short (~4-10s), the sustained phase holds ~50-100 concurrent ' +
      'connections — heavy enough to be meaningful, light enough that no connections drop. ' +
      'The <code class="font-mono text-[12px]">runtime</code> field records which observe driver ' +
      '(<code class="font-mono text-[12px]">oplog</code>/<code class="font-mono text-[12px]">polling</code>/' +
      '<code class="font-mono text-[12px]">changeStreams</code>) and DDP transport ' +
      '(<code class="font-mono text-[12px]">sockjs</code>/<code class="font-mono text-[12px]">uws</code>) ' +
      'each run actually used, so runs are comparable across the matrix.',
  },
  'ddp-reactive-lean': {
    name: 'ddp-reactive-lean',
    driver: 'Artillery + SimpleDDP',
    vus: 'up to 3 new DDP conns/s',
    duration: '~2 min',
    browser: false,
    summary:
      'Lean, precise version of the DDP reactive benchmark. Deliberately light load ' +
      '(2 VU/s warm up → 3 VU/s sustained) kept well below machine capacity so timing ' +
      'metrics reflect true latency without queueing noise. Meant to be run several times ' +
      'per config and compared/medianed across the observer-driver × transport matrix.',
    technical:
      'Artillery drives raw SimpleDDP WebSocket clients: 2 VU/s warm up (15s) then 3 VU/s ' +
      'sustained (100s). Each VU subscribes to <code class="font-mono text-[12px]">fetchTasks</code> ' +
      'and runs insert/remove cycles, fanning reactive updates out through the configured observe ' +
      'driver. Because load stays light (~15-25 concurrent connections), the server never approaches ' +
      'saturation — so CPU, GC, method p95 and propagation latency are clean and reproducible across ' +
      'repeated runs. The <code class="font-mono text-[12px]">runtime</code> field records the actual ' +
      'observe driver (<code class="font-mono text-[12px]">oplog</code>/' +
      '<code class="font-mono text-[12px]">polling</code>/<code class="font-mono text-[12px]">changeStreams</code>) ' +
      'and transport (<code class="font-mono text-[12px]">sockjs</code>/<code class="font-mono text-[12px]">uws</code>) ' +
      'so repeated runs stay comparable.',
  },
  'ddp-non-reactive-light': {
    name: 'ddp-non-reactive-light',
    driver: 'Artillery + SimpleDDP',
    vus: '150 DDP connections',
    duration: '~30s',
    browser: false,
    summary:
      'Same as ddp-reactive-light but without subscribing. Pure method calls over DDP. ' +
      'Isolates Meteor method dispatch + MongoDB write performance.',
    technical:
      '150 SimpleDDP clients connecting over WebSocket. Each VU performs 20 ' +
      '<code class="font-mono text-[12px]">insertTask</code> + 20 ' +
      '<code class="font-mono text-[12px]">removeTask</code> calls without subscribing to any publication. ' +
      'No oplog tailing, no reactive fanout — just method dispatch, MongoDB writes, and DDP response. ' +
      'Comparing with <code class="font-mono text-[12px]">ddp-reactive-light</code> shows the exact cost ' +
      'of pub/sub reactivity at the DDP transport level.',
  },
  'cold-start': {
    name: 'cold-start',
    driver: 'CLI',
    vus: 'N/A',
    duration: 'varies',
    browser: false,
    summary:
      'Measures how long it takes the Meteor app to start from a clean state (after meteor reset). ' +
      'Includes build time, module loading, and initial MongoDB connection.',
    technical:
      'Runs <code class="font-mono text-[12px]">meteor reset</code> followed by ' +
      '<code class="font-mono text-[12px]">meteor run</code> and measures time until ' +
      'the app responds to HTTP requests on port 3000. Includes full isobuild compilation, ' +
      'npm module resolution, server startup, and MongoDB connection. Not yet implemented.',
  },
  'hot-reload': {
    name: 'hot-reload',
    driver: 'CLI',
    vus: 'N/A',
    duration: 'varies',
    browser: false,
    summary:
      'Measures rebuild time after a file change while the app is running. ' +
      'Tests the bundler hot-module-replacement performance.',
    technical:
      'With the app running, modifies a server file and measures time until the server restarts. ' +
      'Then modifies a client file and measures time until HMR applies the change. Not yet implemented.',
  },
  'bundle-size': {
    name: 'bundle-size',
    driver: 'CLI',
    vus: 'N/A',
    duration: 'varies',
    browser: false,
    summary:
      'Measures the output size of client and server bundles after meteor build. ' +
      'Tracks bundle bloat across versions.',
    technical:
      'Runs <code class="font-mono text-[12px]">meteor build</code> and measures the size of the resulting client JS bundle ' +
      'and server bundle. Helps detect dependency bloat or build regressions. Not yet implemented.',
  },
  'build-profile': {
    name: 'build-profile',
    driver: 'CLI',
    vus: 'N/A',
    duration: '~30s',
    browser: false,
    summary:
      'Single Meteor build profiled with METEOR_PROFILE=1, broken down into per-node hot path + per-compiler-plugin time.',
    technical:
      'Spawns <code class="font-mono text-[12px]">meteor build</code> with ' +
      '<code class="font-mono text-[12px]">METEOR_PROFILE=1</code>, parses the captured profile tree, ' +
      'and emits build_profile (top hot nodes by self_ms) and plugin_compile (per-plugin total). ' +
      'Useful for catching long-tail build regressions across Meteor versions.',
  },
};

function whenAgo(ts) {
  if (!ts) return '-';
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

function versionLabel(run) {
  const v = run.meteor?.version;
  if (v && v !== 'system' && v !== 'unknown') return v;
  if (run.runtime?.channel) return run.runtime.channel;
  return 'local';
}

Template.scenario.onCreated(function () {
  this.subscribe('runs.recent', 200);
  this.techOpen = new ReactiveVar(false);
});

Template.scenario.helpers({
  scenarioName() {
    return FlowRouter.getParam('name');
  },
  info() {
    const name = FlowRouter.getParam('name');
    return SCENARIOS[name] || null;
  },
  runCount() {
    const name = FlowRouter.getParam('name');
    return Runs.find({ scenario: name }).count();
  },
  hasRuns() {
    const name = FlowRouter.getParam('name');
    return Runs.find({ scenario: name }).count() > 0;
  },
  runs() {
    const name = FlowRouter.getParam('name');
    return Runs.find({ scenario: name }, { sort: { timestamp: -1 }, limit: 30 }).fetch().map((r) => ({
      ...r,
      whenAgo: whenAgo(r.timestamp),
      versionLabel: versionLabel(r),
      wallClock: r.wall_clock_ms ? `${(r.wall_clock_ms / 1000).toFixed(1)}s` : '-',
      cpuAvg: r.metrics?.app_resources?.cpu?.avg != null
        ? `${r.metrics.app_resources.cpu.avg.toFixed(1)}%` : '-',
      ramAvg: r.metrics?.app_resources?.memory?.avg_mb != null
        ? `${r.metrics.app_resources.memory.avg_mb.toFixed(0)} MB` : '-',
      gcPause: r.metrics?.gc?.total_pause_ms != null
        ? `${r.metrics.gc.total_pause_ms.toFixed(0)} ms` : '-',
    }));
  },
  techOpen() { return Template.instance().techOpen.get(); },
  techArrow() { return Template.instance().techOpen.get() ? '▾' : '▸'; },
});

Template.scenario.events({
  'click #techToggle'(event, instance) {
    instance.techOpen.set(!instance.techOpen.get());
  },
});
