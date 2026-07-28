// Covers resolveMeteorSource and getMeteorInfo for all three modes:
// checkout, system, and release (release added in commit 8).

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { resolveMeteorSource, getMeteorInfo } from '../../meteor-source.js';

let tmpRoot;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'meteor-source-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// Build a directory that looks like a Meteor checkout: a `meteor` file at the
// root. Does NOT make it a git repo — pass { git: true } for that.
function makeFakeCheckout({ git = false } = {}) {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'checkout-'));
  fs.writeFileSync(path.join(dir, 'meteor'), '#!/usr/bin/env bash\n');
  if (git) {
    execSync('git init -q', { cwd: dir });
    execSync('git -c user.email=t@t -c user.name=t commit --allow-empty -q -m init', { cwd: dir });
  }
  return dir;
}

// Directory with no `meteor` binary, so the "checkout binary missing" branch
// is taken and resolution falls through to system mode.
function makeEmptyDir() {
  return fs.mkdtempSync(path.join(tmpRoot, 'empty-'));
}

describe('resolveMeteorSource — checkout mode', () => {
  test('flags["meteor-checkout"] with existing meteor binary → checkout mode', () => {
    const dir = makeFakeCheckout({ git: true });
    const src = resolveMeteorSource({
      flags: { 'meteor-checkout': dir },
      env: {},
      config: {},
    });
    assert.equal(src.mode, 'checkout');
    assert.equal(src.meteorCmd, path.join(dir, 'meteor'));
    assert.equal(src.releaseArg, null);
    assert.equal(src.checkoutPath, dir);
    assert.ok(typeof src.version === 'string' && src.version.length > 0);
    assert.ok(typeof src.sha === 'string' && src.sha.length > 0);
  });

  test('env.METEOR_CHECKOUT_PATH (no flag) → checkout mode', () => {
    const dir = makeFakeCheckout({ git: true });
    const src = resolveMeteorSource({
      flags: {},
      env: { METEOR_CHECKOUT_PATH: dir },
      config: {},
    });
    assert.equal(src.mode, 'checkout');
    assert.equal(src.checkoutPath, dir);
  });

  test('config.meteorCheckoutPath (no flag, no env) → checkout mode', () => {
    const dir = makeFakeCheckout({ git: true });
    const src = resolveMeteorSource({
      flags: {},
      env: {},
      config: { meteorCheckoutPath: dir },
    });
    assert.equal(src.mode, 'checkout');
    assert.equal(src.checkoutPath, dir);
  });

  test('precedence: flag wins over env wins over config', () => {
    const flagDir = makeFakeCheckout({ git: true });
    const envDir = makeFakeCheckout({ git: true });
    const configDir = makeFakeCheckout({ git: true });
    const src = resolveMeteorSource({
      flags: { 'meteor-checkout': flagDir },
      env: { METEOR_CHECKOUT_PATH: envDir },
      config: { meteorCheckoutPath: configDir },
    });
    assert.equal(src.checkoutPath, flagDir);

    const srcEnvBeatsConfig = resolveMeteorSource({
      flags: {},
      env: { METEOR_CHECKOUT_PATH: envDir },
      config: { meteorCheckoutPath: configDir },
    });
    assert.equal(srcEnvBeatsConfig.checkoutPath, envDir);
  });
});

describe('resolveMeteorSource — system mode', () => {
  test('no flag, no env, no config → system mode', () => {
    const src = resolveMeteorSource({ flags: {}, env: {}, config: {} });
    assert.equal(src.mode, 'system');
    assert.equal(src.meteorCmd, 'meteor');
    assert.equal(src.releaseArg, null);
    assert.equal(src.version, 'system');
    assert.equal(src.sha, 'unknown');
    assert.equal(src.checkoutPath, null);
  });

  test('checkout path provided but `meteor` binary missing → falls through to system', () => {
    const empty = makeEmptyDir();
    const src = resolveMeteorSource({
      flags: { 'meteor-checkout': empty },
      env: {},
      config: {},
    });
    assert.equal(src.mode, 'system');
    assert.equal(src.version, 'system');
    assert.equal(src.sha, 'unknown');
  });

  test('env-provided checkout path with no binary → system', () => {
    const empty = makeEmptyDir();
    const src = resolveMeteorSource({
      flags: {},
      env: { METEOR_CHECKOUT_PATH: empty },
      config: {},
    });
    assert.equal(src.mode, 'system');
  });
});

describe('getMeteorInfo', () => {
  test('returns non-empty {version, sha} for a real git checkout', () => {
    const dir = makeFakeCheckout({ git: true });
    const info = getMeteorInfo({ mode: 'checkout', checkoutPath: dir });
    assert.ok(typeof info.version === 'string' && info.version.length > 0, 'version is a non-empty string');
    assert.ok(typeof info.sha === 'string' && info.sha.length > 0, 'sha is a non-empty string');
    // short-sha is typically 7 chars, but git can use 4+ — just assert no whitespace.
    assert.doesNotMatch(info.sha, /\s/);
    assert.doesNotMatch(info.version, /\s/);
  });

  test('throws (no silent "unknown") when checkout path is not a git repo', () => {
    const dir = makeFakeCheckout({ git: false });
    assert.throws(
      () => getMeteorInfo({ mode: 'checkout', checkoutPath: dir }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes(dir), `error message should mention the checkout path; got: ${err.message}`);
        return true;
      }
    );
  });
});

describe('resolveMeteorSource — release mode', () => {
  test('flags["meteor-version"] → release mode with --release arg and "release:" sha prefix', () => {
    const src = resolveMeteorSource({
      flags: { 'meteor-version': '3.1.2' },
      env: {},
      config: {},
    });
    assert.equal(src.mode, 'release');
    assert.equal(src.meteorCmd, 'meteor');
    assert.equal(src.releaseArg, '--release=3.1.2');
    assert.equal(src.version, '3.1.2');
    assert.equal(src.sha, 'release:3.1.2');
    assert.equal(src.checkoutPath, null);
  });

  test('env.METEOR_RELEASE (no flag, no config) → release mode', () => {
    const src = resolveMeteorSource({
      flags: {},
      env: { METEOR_RELEASE: '3.2.0' },
      config: {},
    });
    assert.equal(src.mode, 'release');
    assert.equal(src.version, '3.2.0');
    assert.equal(src.sha, 'release:3.2.0');
    assert.equal(src.releaseArg, '--release=3.2.0');
  });

  test('config.meteorVersion (no flag, no env) → release mode', () => {
    const src = resolveMeteorSource({
      flags: {},
      env: {},
      config: { meteorVersion: '3.0.0' },
    });
    assert.equal(src.mode, 'release');
    assert.equal(src.version, '3.0.0');
    assert.equal(src.sha, 'release:3.0.0');
    assert.equal(src.releaseArg, '--release=3.0.0');
  });

  test('precedence: flag > env > config for version', () => {
    const src = resolveMeteorSource({
      flags: { 'meteor-version': '9.9.9' },
      env: { METEOR_RELEASE: '5.5.5' },
      config: { meteorVersion: '1.1.1' },
    });
    assert.equal(src.version, '9.9.9');

    const envBeatsConfig = resolveMeteorSource({
      flags: {},
      env: { METEOR_RELEASE: '5.5.5' },
      config: { meteorVersion: '1.1.1' },
    });
    assert.equal(envBeatsConfig.version, '5.5.5');
  });

  test('sha carries the literal "release:" prefix (pinned so commit 12 polish does not drop it)', () => {
    const src = resolveMeteorSource({
      flags: { 'meteor-version': '3.1.2' },
      env: {}, config: {},
    });
    assert.equal(src.sha, 'release:3.1.2');
    assert.match(src.sha, /^release:/);
  });

  test('getMeteorInfo on a release source returns pre-baked {version, sha} (no git shelling)', () => {
    // Construct the release source via resolveMeteorSource so the test exercises
    // the contract end-to-end. checkoutPath is null, so if getMeteorInfo
    // attempted to shell out it would throw — we assert it does not.
    const src = resolveMeteorSource({
      flags: { 'meteor-version': '3.1.2' },
      env: {}, config: {},
    });
    const info = getMeteorInfo(src);
    assert.deepEqual(info, { version: '3.1.2', sha: 'release:3.1.2' });
  });
});

describe('resolveMeteorSource — mutual exclusion of version + checkout', () => {
  function assertMutualExclusionError(fn, { version, checkout }) {
    assert.throws(fn, (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mutually exclusive/i, `message should mention "mutually exclusive"; got: ${err.message}`);
      assert.ok(err.message.includes(version), `message should include version=${version}; got: ${err.message}`);
      assert.ok(err.message.includes(checkout), `message should include checkout=${checkout}; got: ${err.message}`);
      return true;
    });
  }

  test('both set in flags → throws with both values in the message', () => {
    const checkout = makeFakeCheckout({ git: true });
    assertMutualExclusionError(
      () => resolveMeteorSource({
        flags: { 'meteor-version': '3.1.2', 'meteor-checkout': checkout },
        env: {}, config: {},
      }),
      { version: '3.1.2', checkout }
    );
  });

  test('both set in env → throws', () => {
    const checkout = makeFakeCheckout({ git: true });
    assertMutualExclusionError(
      () => resolveMeteorSource({
        flags: {},
        env: { METEOR_RELEASE: '3.2.0', METEOR_CHECKOUT_PATH: checkout },
        config: {},
      }),
      { version: '3.2.0', checkout }
    );
  });

  test('both set in config → throws', () => {
    const checkout = makeFakeCheckout({ git: true });
    assertMutualExclusionError(
      () => resolveMeteorSource({
        flags: {},
        env: {},
        config: { meteorVersion: '3.0.0', meteorCheckoutPath: checkout },
      }),
      { version: '3.0.0', checkout }
    );
  });

  test('mixed sources (flag version + env checkout) → throws (cross-source check)', () => {
    const checkout = makeFakeCheckout({ git: true });
    assertMutualExclusionError(
      () => resolveMeteorSource({
        flags: { 'meteor-version': '3.1.2' },
        env: { METEOR_CHECKOUT_PATH: checkout },
        config: {},
      }),
      { version: '3.1.2', checkout }
    );
  });
});
