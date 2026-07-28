// runList prints every scenario, every app, and the resolved Meteor source.
// Pure: takes {config, source} as inputs, writes to stdout. Tests build
// synthetic config + source objects (no mocks needed beyond console.log capture).

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runList } from '../../cli/list.js';

let logs;
let origLog;

beforeEach(() => {
  logs = [];
  origLog = console.log;
  console.log = (msg) => logs.push(String(msg));
});

afterEach(() => {
  console.log = origLog;
});

const SAMPLE_CONFIG = {
  scenarios: {
    'reactive-light': { driver: 'artillery-playwright', description: 'Light reactive CRUD with 30 browser VUs' },
    'fanout-heavy': { driver: 'script', description: 'Reactive fanout: 200 subscribers' },
    'cold-start': { driver: 'cli', description: 'App startup time from clean state' },
  },
  apps: {
    'tasks-3.x': { description: 'Meteor 3 React task app' },
  },
};

const SYSTEM_SOURCE = {
  mode: 'system', meteorCmd: 'meteor', releaseArg: null,
  version: 'system', sha: 'unknown', checkoutPath: null,
};

const CHECKOUT_SOURCE = {
  mode: 'checkout', meteorCmd: '/Users/me/meteor/meteor', releaseArg: null,
  version: 'release/3.5', sha: 'abc1234', checkoutPath: '/Users/me/meteor',
};

const RELEASE_SOURCE = {
  mode: 'release', meteorCmd: 'meteor', releaseArg: '--release=3.1.2',
  version: '3.1.2', sha: 'release:3.1.2', checkoutPath: null,
};

describe('runList — scenarios + apps', () => {
  test('prints every scenario name and its description', () => {
    runList({ config: SAMPLE_CONFIG, source: SYSTEM_SOURCE });
    const out = logs.join('\n');
    for (const name of Object.keys(SAMPLE_CONFIG.scenarios)) {
      assert.ok(out.includes(name), `expected scenario "${name}" in output`);
    }
    for (const s of Object.values(SAMPLE_CONFIG.scenarios)) {
      assert.ok(out.includes(s.description), `expected description "${s.description}" in output`);
    }
  });

  test('prints every app name and its description', () => {
    runList({ config: SAMPLE_CONFIG, source: SYSTEM_SOURCE });
    const out = logs.join('\n');
    assert.ok(out.includes('tasks-3.x'));
    assert.ok(out.includes('Meteor 3 React task app'));
  });

  test('section headers are present', () => {
    runList({ config: SAMPLE_CONFIG, source: SYSTEM_SOURCE });
    const out = logs.join('\n');
    assert.ok(out.includes('Available scenarios:'));
    assert.ok(out.includes('Available apps:'));
  });
});

describe('runList — Meteor source line', () => {
  test('system source: mode + version + sha (no checkout line)', () => {
    runList({ config: SAMPLE_CONFIG, source: SYSTEM_SOURCE });
    const out = logs.join('\n');
    assert.ok(out.includes('Meteor source: system'));
    assert.ok(out.includes('Version: system'));
    assert.ok(out.includes('SHA: unknown'));
    assert.ok(!out.includes('Checkout:'), 'system source should not print a Checkout line');
  });

  test('checkout source: prints Checkout path AND version + sha', () => {
    runList({ config: SAMPLE_CONFIG, source: CHECKOUT_SOURCE });
    const out = logs.join('\n');
    assert.ok(out.includes('Meteor source: checkout'));
    assert.ok(out.includes('Checkout: /Users/me/meteor'));
    assert.ok(out.includes('Version: release/3.5'));
    assert.ok(out.includes('SHA: abc1234'));
  });

  test('release source: mode + pinned version + release: sha (no Checkout line)', () => {
    runList({ config: SAMPLE_CONFIG, source: RELEASE_SOURCE });
    const out = logs.join('\n');
    assert.ok(out.includes('Meteor source: release'));
    assert.ok(out.includes('Version: 3.1.2'));
    assert.ok(out.includes('SHA: release:3.1.2'));
    assert.ok(!out.includes('Checkout:'), 'release source should not print a Checkout line');
  });
});

describe('runList — empty configs', () => {
  test('empty scenarios + apps still prints headers and source line', () => {
    runList({ config: { scenarios: {}, apps: {} }, source: SYSTEM_SOURCE });
    const out = logs.join('\n');
    assert.ok(out.includes('Available scenarios:'));
    assert.ok(out.includes('Available apps:'));
    assert.ok(out.includes('Meteor source: system'));
  });
});
