// Plain-object I/O facade. Workaround for ESM: node:* namespace exports
// are non-configurable, so `mock.method(childProcess, 'execSync', ...)`
// throws. A plain object whose values happen to be node:* functions IS
// configurable, so tests can stub here without DI in prod signatures.
//
// Production: `import { io } from './_io.js'`, then `io.execSync(...)`.
// Tests:      `mock.method(io, 'execSync', () => 'fake-stdout')`.
//
// Single facade for the whole codebase — extend, don't fork.

import { execSync as _execSync, execFileSync as _execFileSync, spawn as _spawn } from 'node:child_process';
import { existsSync as _existsSync, readFileSync as _readFileSync, unlinkSync as _unlinkSync, mkdirSync as _mkdirSync, readdirSync as _readdirSync, writeFileSync as _writeFileSync, statSync as _statSync, rmSync as _rmSync } from 'node:fs';
import { setTimeout as _sleep } from 'node:timers/promises';
import _SimpleDDP from 'simpleddp';
import _ws from 'ws';
import { MongoClient as _MongoClient } from 'mongodb';

export const io = {
  execSync: _execSync,
  execFileSync: _execFileSync,
  spawn: _spawn,
  existsSync: _existsSync,
  readFileSync: _readFileSync,
  unlinkSync: _unlinkSync,
  mkdirSync: _mkdirSync,
  readdirSync: _readdirSync,
  writeFileSync: _writeFileSync,
  statSync: _statSync,
  rmSync: _rmSync,
  sleep: _sleep,
  // Wrapper (not a bound reference) so tests can replace globalThis.fetch
  // without re-loading this module. mock.method(io, 'fetch', ...) also works.
  fetch: (...args) => globalThis.fetch(...args),
  SimpleDDP: _SimpleDDP,
  ws: _ws,
  MongoClient: _MongoClient,
};
