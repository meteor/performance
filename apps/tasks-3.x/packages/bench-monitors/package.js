// In-app monitoring hooks for the benchmark harness. Each .server.js
// here patches a Meteor API (Meteor.methods, Meteor.publish, Session,
// observers, etc.) to record samples when the matching <COLLECTOR>_OUTPUT
// env var is set by the harness. Without the env var the hooks are no-ops
// — package is transparent in normal dev.
//
// Separated from `tasks-common` (domain code: Tasks collection, methods,
// UI) so the app's business logic stays clean and the monitoring surface
// can grow without polluting it. Future tasks that need Meteor-API hooks
// (subscription latency, live-update propagation, observer pool, DDP
// middleware, driver fallback, oplog backlog, etc.) live here.

Package.describe({
  name: 'bench-monitors',
  version: '0.0.1',
  summary: 'In-app instrumentation hooks for the benchmark harness',
  documentation: 'README.md',
});

Package.onUse(function (api) {
  api.versionsFrom('2.16');
  api.use('ecmascript');
  api.mainModule('bench-monitors.server.js', ['server']);
});
