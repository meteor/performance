// End-to-end cli/compare.js: real fs (fixtures + tmpdir for error paths),
// real regression-detector, captured stdout/stderr, stubbed process.exit so
// failure paths throw ExitError instead of terminating the test runner.

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCompare } from '../../cli/compare.js';

class ExitError extends Error {
  constructor(code) { super(`process.exit(${code})`); this.code = code; }
}

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const fix = (name) => path.join(FIXTURES, name);

let tmpDir;
let logs;
let errors;
let origLog;
let origError;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-cmd-'));
  logs = [];
  errors = [];
  origLog = console.log;
  origError = console.error;
  console.log = (msg) => logs.push(String(msg));
  console.error = (msg) => errors.push(String(msg));
  mock.method(process, 'exit', (code) => { throw new ExitError(code); });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log = origLog;
  console.error = origError;
  mock.restoreAll();
});

describe('runCompare — happy paths', () => {
  test('passing fixture pair → exit 0, markdown header has ✅', () => {
    assert.throws(
      () => runCompare({ values: { baseline: fix('baseline.json'), target: fix('target.json') } }),
      (err) => err instanceof ExitError && err.code === 0
    );
    const md = logs.join('\n');
    assert.match(md, /^## ✅ Benchmark: reactive-light/m);
    assert.match(md, /\| wall_clock_ms \|/);
  });

  test('regression fixture pair → exit 1, ❌ header + regression line', () => {
    assert.throws(
      () => runCompare({ values: { baseline: fix('baseline.json'), target: fix('target-regression.json') } }),
      (err) => err instanceof ExitError && err.code === 1
    );
    const md = logs.join('\n');
    assert.match(md, /^## ❌ Benchmark: reactive-light/m);
    assert.match(md, /regression\(s\) detected/);
  });

  test('improvement fixture pair → exit 0, all rows ok', () => {
    assert.throws(
      () => runCompare({ values: { baseline: fix('baseline.json'), target: fix('target-improvement.json') } }),
      (err) => err instanceof ExitError && err.code === 0
    );
    const md = logs.join('\n');
    assert.match(md, /^## ✅ Benchmark:/m);
    assert.doesNotMatch(md, /❌/);
  });

  test('--format json prints parseable JSON report (not markdown), exit 0 on pass', () => {
    assert.throws(
      () => runCompare({
        values: { baseline: fix('baseline.json'), target: fix('target.json'), format: 'json' },
      }),
      (err) => err instanceof ExitError && err.code === 0
    );
    const out = logs.join('\n');
    const parsed = JSON.parse(out);
    assert.equal(parsed.summary.passed, true);
    assert.equal(parsed.summary.scenario, 'reactive-light');
    assert.ok(Array.isArray(parsed.details));
  });
});

describe('runCompare — failure paths', () => {
  test('missing --baseline exits 1 with usage on stderr', () => {
    assert.throws(
      () => runCompare({ values: { target: fix('target.json') } }),
      (err) => err instanceof ExitError && err.code === 1
    );
    assert.ok(errors.some((e) => e.includes('Usage: node bench.js compare')));
  });

  test('missing --target exits 1 with usage on stderr', () => {
    assert.throws(
      () => runCompare({ values: { baseline: fix('baseline.json') } }),
      (err) => err instanceof ExitError && err.code === 1
    );
    assert.ok(errors.some((e) => e.includes('Usage: node bench.js compare')));
  });

  test('empty values exits 1 with usage', () => {
    assert.throws(
      () => runCompare({ values: {} }),
      (err) => err instanceof ExitError && err.code === 1
    );
    assert.ok(errors.some((e) => e.includes('Usage: node bench.js compare')));
  });

  test('nonexistent baseline path exits 1 with path + ENOENT + actionable hint', () => {
    const missing = path.join(tmpDir, 'does-not-exist.json');
    assert.throws(
      () => runCompare({ values: { baseline: missing, target: fix('target.json') } }),
      (err) => err instanceof ExitError && err.code === 1
    );
    const errText = errors.join('\n');
    assert.match(errText, /Could not read baseline file/);
    assert.ok(errText.includes(missing), `expected path "${missing}" in stderr; got: ${errText}`);
    assert.match(errText, /Check the path or run 'bench.js run' first to produce it/);
  });

  test('nonexistent target path exits 1 with target label in the message', () => {
    const missing = path.join(tmpDir, 'no-target.json');
    assert.throws(
      () => runCompare({ values: { baseline: fix('baseline.json'), target: missing } }),
      (err) => err instanceof ExitError && err.code === 1
    );
    const errText = errors.join('\n');
    assert.match(errText, /Could not read target file/);
    assert.ok(errText.includes(missing));
  });

  test('malformed JSON in baseline exits 1 with parse-error + actionable hint', () => {
    const garbagePath = path.join(tmpDir, 'garbage.json');
    fs.writeFileSync(garbagePath, '{not-json{{{');
    assert.throws(
      () => runCompare({ values: { baseline: garbagePath, target: fix('target.json') } }),
      (err) => err instanceof ExitError && err.code === 1
    );
    const errText = errors.join('\n');
    assert.match(errText, /Could not parse baseline file/);
    assert.match(errText, /Is the file a valid bench\.js result\?/);
  });

  test('malformed JSON in target exits 1 with target label in parse-error', () => {
    const garbagePath = path.join(tmpDir, 'garbage.json');
    fs.writeFileSync(garbagePath, '{"oops":');
    assert.throws(
      () => runCompare({ values: { baseline: fix('baseline.json'), target: garbagePath } }),
      (err) => err instanceof ExitError && err.code === 1
    );
    const errText = errors.join('\n');
    assert.match(errText, /Could not parse target file/);
  });
});
