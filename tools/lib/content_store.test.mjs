import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  writeJsonAtomic,
  acquireContentLock,
  releaseContentLock,
  withContentLock,
  isContentLocked,
} from './content_store.mjs';

function tempTarget() {
  return join(mkdtempSync(join(tmpdir(), 'content-store-')), 'content.json');
}

test('writeJsonAtomic writes parseable JSON and leaves no temp file behind', () => {
  const target = tempTarget();
  writeJsonAtomic(target, { a: 1, b: ['x'] });
  assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { a: 1, b: ['x'] });
  const leftovers = readdirSync(join(target, '..')).filter((f) => f.includes('.tmp-'));
  assert.deepEqual(leftovers, []);
});

test('writeJsonAtomic replaces existing content', () => {
  const target = tempTarget();
  writeJsonAtomic(target, { v: 1 });
  writeJsonAtomic(target, { v: 2 });
  assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { v: 2 });
});

test('second lock acquisition throws while held, works after release', () => {
  const target = tempTarget();
  acquireContentLock(target, { tool: 'test-a' });
  assert.ok(isContentLocked(target));
  assert.throws(() => acquireContentLock(target, { tool: 'test-b' }), /locked by test-a/);
  releaseContentLock(target);
  assert.ok(!isContentLocked(target));
  acquireContentLock(target, { tool: 'test-b' });
  releaseContentLock(target);
});

test('stale lock is taken over', () => {
  const target = tempTarget();
  writeFileSync(`${target}.lock`, JSON.stringify({ pid: 1, tool: 'dead', ts: Date.now() - 60_000 }));
  acquireContentLock(target, { tool: 'test', staleMs: 1000 });
  releaseContentLock(target);
});

test('withContentLock releases on success and on throw', () => {
  const target = tempTarget();
  const out = withContentLock(target, () => 42, { tool: 'test' });
  assert.equal(out, 42);
  assert.ok(!isContentLocked(target));
  assert.throws(() => withContentLock(target, () => { throw new Error('boom'); }, { tool: 'test' }), /boom/);
  assert.ok(!isContentLocked(target));
});
