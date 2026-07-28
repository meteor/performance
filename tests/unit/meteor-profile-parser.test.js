import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseMeteorProfile } from '../../runner/meteor-profile-parser.js';

describe('parseMeteorProfile', () => {
  test('empty / non-string input → empty nodes, null total', () => {
    assert.deepEqual(parseMeteorProfile(''), { total_ms: null, nodes: [] });
    assert.deepEqual(parseMeteorProfile(null), { total_ms: null, nodes: [] });
    assert.deepEqual(parseMeteorProfile(undefined), { total_ms: null, nodes: [] });
  });

  test('single top-level node with count', () => {
    const { nodes, total_ms } = parseMeteorProfile('| files.readFile                 134 ms (675)');
    assert.equal(total_ms, null);
    assert.deepEqual(nodes, [{ name: 'files.readFile', self_ms: 134, count: 675, depth: 0 }]);
  });

  test('dot-leader padding is stripped from the name (parent-with-children style)', () => {
    const { nodes } = parseMeteorProfile('| bundler.readJsImage...............................................7 ms (7)');
    assert.equal(nodes[0].name, 'bundler.readJsImage');
    assert.equal(nodes[0].self_ms, 7);
    assert.equal(nodes[0].count, 7);
  });

  test('count is optional (synthetic "other X" roll-up lines omit it)', () => {
    const { nodes } = parseMeteorProfile('| │  └─ other safeWatcher.watch                                     4 ms');
    assert.equal(nodes[0].name, 'other safeWatcher.watch');
    assert.equal(nodes[0].self_ms, 4);
    assert.equal(nodes[0].count, null);
  });

  test('thousands commas stripped from ms and count', () => {
    const { nodes } = parseMeteorProfile('| files.readFile...........................................1,931 ms (40873)');
    assert.equal(nodes[0].self_ms, 1931);
    assert.equal(nodes[0].count, 40873);
  });

  test('depth from box-drawing prefixes (├─ └─ │) — 3 columns per level', () => {
    const text = [
      '| meteorNpm.rebuildIfNonPortable.................................4 ms (6)',
      '| ├─ files.stat                                                  2 ms (12)',
      '| └─ meteorNpm.isPortable                                        2 ms (6)',
      '|    └─ files.lstat                                              1 ms (6)',
      '| │  ├─ files.watchFile                                         10 ms (1984)',
    ].join('\n');
    const { nodes } = parseMeteorProfile(text);
    assert.equal(nodes[0].depth, 0); // top-level
    assert.equal(nodes[1].depth, 1); // ├─
    assert.equal(nodes[2].depth, 1); // └─
    assert.equal(nodes[3].depth, 2); // 3-space + └─
    assert.equal(nodes[4].depth, 2); // │ + ├─
    assert.equal(nodes[3].name, 'files.lstat');
  });

  test('Total: line captured as total_ms (with comma), not added as a node', () => {
    const text = [
      '| files.chmod                                                       0 ms (1)',
      '| ',
      '| (#1) Total: 6,202 ms (meteor build)',
      '| ',
    ].join('\n');
    const { nodes, total_ms } = parseMeteorProfile(text);
    assert.equal(total_ms, 6202);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].name, 'files.chmod');
  });

  test('"Profiling:" header and bare "| " blank lines are skipped', () => {
    const text = [
      '| (#1) Profiling: meteor build',
      '| ',
      '| meteor build                                                      7 ms (1)',
    ].join('\n');
    const { nodes } = parseMeteorProfile(text);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].name, 'meteor build');
  });

  test('"Top leaves:" block is skipped entirely (duplicate ranking)', () => {
    const text = [
      '| files.readFile                                                  134 ms (675)',
      '| ',
      '| Top leaves:',
      '| files.readFile...........................................1,931 ms (40873)',
      '| files.writeFile..........................................1,253 ms (18700)',
      '| ',
      '| (#1) Total: 6,202 ms (meteor build)',
    ].join('\n');
    const { nodes } = parseMeteorProfile(text);
    // Only the in-tree files.readFile (134ms) — NOT the 1,931ms top-leaf dup.
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].self_ms, 134);
  });

  test('lines not starting with "| " are ignored (e.g. bare Warning)', () => {
    const text = [
      'Warning: Nested Profile.run at ProjectContext prepareProjectForBuild',
      '| plugin ecmascript                                                 3 ms (3)',
    ].join('\n');
    const { nodes } = parseMeteorProfile(text);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].name, 'plugin ecmascript');
  });

  test('plugin lines parse as plain nodes named "plugin <name>"', () => {
    const text = [
      '| plugin ecmascript                                                 3 ms (3)',
      '| plugin typescript                                                 0 ms (3)',
      '| plugin static-html                                                1 ms (2)',
    ].join('\n');
    const { nodes } = parseMeteorProfile(text);
    assert.deepEqual(nodes.map((n) => n.name), ['plugin ecmascript', 'plugin typescript', 'plugin static-html']);
    assert.equal(nodes[0].self_ms, 3);
    assert.equal(nodes[1].self_ms, 0);
  });

  test('malformed / non-data lines are skipped, do not throw', () => {
    const text = [
      '| this line has no millis value at all',
      '| another | weird || line',
      '| files.stat                                                      55 ms (1984)',
    ].join('\n');
    let parsed;
    assert.doesNotThrow(() => { parsed = parseMeteorProfile(text); });
    assert.equal(parsed.nodes.length, 1);
    assert.equal(parsed.nodes[0].name, 'files.stat');
  });

  test('truncated input (build crashed mid-profile) parses what is there', () => {
    // No Total line; last line cut off mid-way.
    const text = [
      '| files.readFile                                                  134 ms (675)',
      '| sha1                                                              7 ms (2345)',
      '| files.real',
    ].join('\n');
    const { nodes, total_ms } = parseMeteorProfile(text);
    assert.equal(total_ms, null);
    assert.equal(nodes.length, 2);
  });

  describe('against the real captured fixture', () => {
    const fixturePath = path.join(import.meta.dirname, 'fixtures', 'meteor-profile-sample.txt');
    const hasFixture = fs.existsSync(fixturePath);

    test('parses total_ms, a large node list, and the 4 plugin nodes', { skip: !hasFixture }, () => {
      const text = fs.readFileSync(fixturePath, 'utf8');
      const { nodes, total_ms } = parseMeteorProfile(text);
      assert.equal(total_ms, 6202);
      assert.ok(nodes.length > 100, `expected many nodes, got ${nodes.length}`);
      const plugins = nodes.filter((n) => n.name.startsWith('plugin '));
      assert.deepEqual(
        plugins.map((p) => p.name).sort(),
        ['plugin ecmascript', 'plugin meteor', 'plugin static-html', 'plugin typescript'],
      );
      // No "Top leaves:" duplicate should sneak in: the 1,931ms top-leaf
      // files.readFile must NOT appear (the in-tree one is far smaller).
      assert.ok(!nodes.some((n) => n.name === 'files.readFile' && n.self_ms === 1931));
    });
  });
});
