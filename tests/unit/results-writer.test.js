import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeResult, appendToHistory } from '../../reporters/json-reporter.js';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-results-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('writeResult', () => {
  test('writes JSON file with trailing newline', () => {
    const outputPath = path.join(tmpDir, 'result.json');
    const result = { scenario: 's', app: 'a', tag: 't', metrics: {} };
    writeResult(result, outputPath);
    const raw = fs.readFileSync(outputPath, 'utf8');
    assert.ok(raw.endsWith('\n'), 'file ends with newline');
    assert.deepEqual(JSON.parse(raw), result);
  });

  test('creates nested parent directories when missing', () => {
    const outputPath = path.join(tmpDir, 'nested', 'deep', 'result.json');
    writeResult({ scenario: 's', app: 'a', tag: 't', metrics: {} }, outputPath);
    assert.ok(fs.existsSync(outputPath));
    assert.ok(fs.statSync(path.dirname(outputPath)).isDirectory());
  });

  test('overwrites an existing file', () => {
    const outputPath = path.join(tmpDir, 'result.json');
    writeResult({ tag: 'first' }, outputPath);
    writeResult({ tag: 'second' }, outputPath);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).tag, 'second');
  });

  test('pretty-prints with 2-space indentation', () => {
    const outputPath = path.join(tmpDir, 'result.json');
    writeResult({ scenario: 's', metrics: { gc: { count: 1 } } }, outputPath);
    const raw = fs.readFileSync(outputPath, 'utf8');
    assert.ok(raw.includes('\n  "scenario"'), 'top-level keys indented with 2 spaces');
    assert.ok(raw.includes('\n    "gc"'), 'nested keys indented with 4 spaces');
  });
});

describe('appendToHistory', () => {
  test('writes a file with the pattern <scenario>-<tag>-<timestamp>.json', () => {
    const result = { scenario: 'reactive-light', tag: 'v3.5', metrics: {} };
    appendToHistory(result, tmpDir);
    const files = fs.readdirSync(tmpDir);
    assert.equal(files.length, 1);
    assert.match(files[0], /^reactive-light-v3\.5-\d+\.json$/);
  });

  test('creates the history directory when missing', () => {
    const historyDir = path.join(tmpDir, 'new-history-dir');
    appendToHistory({ scenario: 's', tag: 't', metrics: {} }, historyDir);
    assert.ok(fs.existsSync(historyDir));
    assert.equal(fs.readdirSync(historyDir).length, 1);
  });

  test('two appends produce two distinct files', async () => {
    const result = { scenario: 's', tag: 't', metrics: {} };
    appendToHistory(result, tmpDir);
    await sleep(2); // guarantee Date.now() advances on fast machines
    appendToHistory(result, tmpDir);
    assert.equal(fs.readdirSync(tmpDir).length, 2);
  });

  test('written history file contents match the input result', () => {
    const result = { scenario: 's', tag: 't', metrics: { gc: { count: 1 } } };
    appendToHistory(result, tmpDir);
    const file = fs.readdirSync(tmpDir)[0];
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmpDir, file), 'utf8')), result);
  });
});
