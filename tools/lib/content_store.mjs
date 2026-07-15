// Safe writes for the shared source-of-truth JSON (packs/lexicon_source/content.json).
//
// Two failure classes this closes (MT-C5 design, OVE-5):
// 1. A crash mid-write leaves a truncated/corrupt file. Fix: write to a temp
//    file in the same directory, then rename over the target (atomic on the
//    same filesystem).
// 2. Two long-running writers (interconnect --apply, tier_synonyms batches,
//    the relation review-queue approver) interleave whole-file
//    read-modify-write and silently lose whichever wrote first. Fix: an
//    advisory lockfile every writer acquires around its read-modify-write.
//
// The lock is advisory: it only protects writers that use it. All content.json
// writers in this repo go through withContentLock.

import { writeFileSync, renameSync, rmSync, openSync, closeSync, readFileSync, existsSync } from 'fs';

const DEFAULT_STALE_MS = 30 * 60 * 1000; // a writer silent for 30 min is presumed dead

/** Serialize and atomically replace `path` (temp file + rename, same dir). */
export function writeJsonAtomic(path, data) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  try {
    renameSync(tmp, path);
  } catch (err) {
    // Windows can refuse a rename over a file another process holds open.
    // Surface it after cleaning up the temp file - never leave both behind.
    rmSync(tmp, { force: true });
    throw err;
  }
}

function lockPath(path) {
  return `${path}.lock`;
}

/** Acquire the advisory lock for `path` or throw naming the holder. */
export function acquireContentLock(path, { tool = 'unknown', staleMs = DEFAULT_STALE_MS } = {}) {
  const lock = lockPath(path);
  const payload = JSON.stringify({ pid: process.pid, tool, ts: Date.now() });
  try {
    const fd = openSync(lock, 'wx');
    writeFileSync(fd, payload);
    closeSync(fd);
    return;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  // Lock exists: stale (holder crashed / forgot) or genuinely held.
  let holder = {};
  try {
    holder = JSON.parse(readFileSync(lock, 'utf8'));
  } catch {
    /* unreadable lock counts as stale */
  }
  const age = Date.now() - (holder.ts ?? 0);
  if (age > staleMs) {
    rmSync(lock, { force: true });
    console.warn(`Stale content lock (held by ${holder.tool ?? '?'} pid ${holder.pid ?? '?'}, ${Math.round(age / 60000)} min old) - taking over.`);
    return acquireContentLock(path, { tool, staleMs });
  }
  throw new Error(
    `content.json is locked by ${holder.tool ?? 'another tool'} (pid ${holder.pid ?? '?'}). ` +
    `Wait for it to finish, or delete ${lock} if you are sure it is dead.`
  );
}

export function releaseContentLock(path) {
  rmSync(lockPath(path), { force: true });
}

export function isContentLocked(path) {
  return existsSync(lockPath(path));
}

/** Run `fn` while holding the advisory lock for `path`; always releases. */
export function withContentLock(path, fn, options = {}) {
  acquireContentLock(path, options);
  try {
    return fn();
  } finally {
    releaseContentLock(path);
  }
}
