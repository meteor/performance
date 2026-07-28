import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeInfoExtractor } from '../../runner/runtime-info-extractor.js';

describe('createRuntimeInfoExtractor', () => {
  test('captures a single complete line', () => {
    const ex = createRuntimeInfoExtractor();
    ex.feed('[runtime-info] observer_driver=changeStreams\n');
    assert.deepEqual(ex.get(), { observer_driver: 'changeStreams' });
  });

  test('captures multiple distinct keys', () => {
    const ex = createRuntimeInfoExtractor();
    ex.feed('[runtime-info] observer_driver=oplog\n[runtime-info] transport=uws\n');
    assert.deepEqual(ex.get(), { observer_driver: 'oplog', transport: 'uws' });
  });

  test('reassembles a line split across two chunks', () => {
    const ex = createRuntimeInfoExtractor();
    ex.feed('[runtime-info] observer');
    ex.feed('_driver=changeStreams\n');
    assert.deepEqual(ex.get(), { observer_driver: 'changeStreams' });
  });

  test('reassembles when the newline lands in a later chunk', () => {
    const ex = createRuntimeInfoExtractor();
    ex.feed('[runtime-info] transport=sockjs');
    ex.feed('\n[runtime-info] observer_driver=polling\n');
    assert.deepEqual(ex.get(), { transport: 'sockjs', observer_driver: 'polling' });
  });

  test('ignores non-matching lines (e.g. normal Meteor output)', () => {
    const ex = createRuntimeInfoExtractor();
    ex.feed('=> Meteor server running on http://localhost:3000\n');
    ex.feed('I20260601-12:00:00.000(0)? Application started\n');
    ex.feed('[runtime-info] observer_driver=oplog\n');
    ex.feed('Some unrelated stderr output\n');
    assert.deepEqual(ex.get(), { observer_driver: 'oplog' });
  });

  test('later value for the same key wins (cold-start re-emits)', () => {
    const ex = createRuntimeInfoExtractor();
    ex.feed('[runtime-info] observer_driver=changeStreams\n');
    ex.feed('[runtime-info] observer_driver=oplog\n');
    assert.deepEqual(ex.get(), { observer_driver: 'oplog' });
  });

  test('get() returns a defensive copy', () => {
    const ex = createRuntimeInfoExtractor();
    ex.feed('[runtime-info] transport=sockjs\n');
    const snapshot = ex.get();
    snapshot.transport = 'TAMPERED';
    assert.deepEqual(ex.get(), { transport: 'sockjs' });
  });

  test('returns empty object when nothing matches', () => {
    const ex = createRuntimeInfoExtractor();
    ex.feed('=> Server starting...\n');
    ex.feed('Some other log line\n');
    assert.deepEqual(ex.get(), {});
  });

  test('values can contain "=" characters (e.g. URLs, key=val=other)', () => {
    const ex = createRuntimeInfoExtractor();
    ex.feed('[runtime-info] transport=ws://localhost:3000?key=value\n');
    assert.deepEqual(ex.get(), { transport: 'ws://localhost:3000?key=value' });
  });

  test('handles Buffer chunks (not just strings)', () => {
    const ex = createRuntimeInfoExtractor();
    ex.feed(Buffer.from('[runtime-info] observer_driver=polling\n'));
    assert.deepEqual(ex.get(), { observer_driver: 'polling' });
  });

  test('buffered partial line that never terminates is not captured', () => {
    const ex = createRuntimeInfoExtractor();
    ex.feed('[runtime-info] observer_driver=changeStreams'); // no \n
    assert.deepEqual(ex.get(), {});
  });
});
