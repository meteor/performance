import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregatePluginCompile } from '../../runner/plugin-compile-aggregator.js';

const node = (name, self_ms, count = 1, depth = 0) => ({ name, self_ms, count, depth });

describe('aggregatePluginCompile', () => {
  test('null / non-array nodes → null', () => {
    assert.equal(aggregatePluginCompile(null), null);
    assert.equal(aggregatePluginCompile({}), null);
    assert.equal(aggregatePluginCompile({ nodes: 'nope' }), null);
  });

  test('no plugin-prefixed nodes → null (absence convention CC-5)', () => {
    const parsed = { nodes: [node('files.readFile', 100), node('bundler.bundle', 50)] };
    assert.equal(aggregatePluginCompile(parsed), null);
  });

  test('extracts plugin nodes, strips "plugin " prefix', () => {
    const parsed = {
      nodes: [
        node('files.readFile', 100),
        node('plugin ecmascript', 3, 3),
        node('plugin typescript', 0, 3),
        node('plugin static-html', 1, 2),
      ],
    };
    const r = aggregatePluginCompile(parsed);
    assert.deepEqual(Object.keys(r.plugins).sort(), ['ecmascript', 'static-html', 'typescript']);
    assert.deepEqual(r.plugins.ecmascript, { self_ms: 3, count: 3 });
    assert.deepEqual(r.plugins['static-html'], { self_ms: 1, count: 2 });
  });

  test('total_plugin_ms = sum of plugin self_ms', () => {
    const parsed = {
      nodes: [node('plugin ecmascript', 3, 3), node('plugin standard-minifier-js', 1850, 1), node('plugin static-html', 1, 2)],
    };
    const r = aggregatePluginCompile(parsed);
    assert.equal(r.total_plugin_ms, 1854);
  });

  test('count preserved per plugin', () => {
    const parsed = { nodes: [node('plugin ecmascript', 1350, 47)] };
    const r = aggregatePluginCompile(parsed);
    assert.equal(r.plugins.ecmascript.count, 47);
  });

  test('recurring plugin name → self_ms and count summed into one entry', () => {
    const parsed = {
      nodes: [node('plugin ecmascript', 3, 3), node('plugin ecmascript', 5, 2)],
    };
    const r = aggregatePluginCompile(parsed);
    assert.deepEqual(r.plugins.ecmascript, { self_ms: 8, count: 5 });
    assert.equal(r.total_plugin_ms, 8);
  });

  test('does not match names that merely contain "plugin" mid-string', () => {
    const parsed = {
      nodes: [node('runJavaScript packages/compile-ecmascript_plugin.js', 0), node('Isopack#ensurePluginsInitialized', 1, 429)],
    };
    // Neither starts with "plugin " → no plugin entries → null.
    assert.equal(aggregatePluginCompile(parsed), null);
  });

  test('plugin node with null count treated as 0', () => {
    const parsed = { nodes: [{ name: 'plugin meteor', self_ms: 0, count: null, depth: 0 }] };
    const r = aggregatePluginCompile(parsed);
    assert.deepEqual(r.plugins.meteor, { self_ms: 0, count: 0 });
  });

  test('zero-ms plugins still listed (they ran, count > 0)', () => {
    const parsed = { nodes: [node('plugin typescript', 0, 3)] };
    const r = aggregatePluginCompile(parsed);
    assert.deepEqual(r.plugins.typescript, { self_ms: 0, count: 3 });
    assert.equal(r.total_plugin_ms, 0);
  });

  test('shape contract: metric name + exact top-level key set', () => {
    const r = aggregatePluginCompile({ nodes: [node('plugin ecmascript', 3, 3)] });
    assert.equal(r.metric, 'plugin_compile');
    assert.deepEqual(Object.keys(r).sort(), ['metric', 'plugins', 'total_plugin_ms']);
  });
});
