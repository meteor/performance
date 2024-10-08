Package.describe({
  name: 'apm-agent',
  version: '0.0.1',
  // Brief, one-line summary of the package.
  summary: '',
  // URL to the Git repository containing the source code for this package.
  git: '',
  // By default, Meteor will default to using README.md for documentation.
  // To avoid submitting documentation, set this field to null.
  documentation: 'README.md'
});

Package.onUse(function(api) {
  api.versionsFrom('2.16');
  api.use('ecmascript');
  api.use('montiapm:agent');
  api.use('montiapm:profiler');
  api.mainModule('apm-agent.server.js', ['server']);
});
