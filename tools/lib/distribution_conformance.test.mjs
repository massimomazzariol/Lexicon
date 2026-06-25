import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CONTRACT_VERSION, validateDistribution } from './distribution_conformance.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const goldenDir = path.join(repoRoot, 'tools', 'fixtures', 'golden_distribution');
const builtDir = path.join(repoRoot, 'dist', 'lexicon_distribution');

test('contract version is 0.1.0', () => {
  assert.equal(CONTRACT_VERSION, '0.1.0');
});

test('the committed golden fixture is conformant', () => {
  assert.deepEqual(validateDistribution(goldenDir), []);
});

test('the built distribution is conformant', { skip: !fs.existsSync(builtDir) }, () => {
  assert.deepEqual(validateDistribution(builtDir), []);
});

// A copy of the golden fixture with one field broken must be REJECTED. This is
// the guard that proves drift is caught, not silently accepted.
function cloneGolden() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-clone-'));
  fs.cpSync(goldenDir, dir, { recursive: true });
  return dir;
}

test('rejects an unknown contract_version', () => {
  const dir = cloneGolden();
  try {
    const rootPath = path.join(dir, 'root_manifest.json');
    const root = JSON.parse(fs.readFileSync(rootPath, 'utf8'));
    root.contract_version = '9.9.9';
    fs.writeFileSync(rootPath, JSON.stringify(root, null, 2));
    const errors = validateDistribution(dir);
    assert.ok(
      errors.some((e) => e.includes('contract_version')),
      `expected a contract_version error, got: ${errors.join(' | ')}`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a tampered payload (content_hash mismatch)', () => {
  const dir = cloneGolden();
  try {
    const payload = path.join(dir, 'chunks', 'de', 'lexicon.de.a1.golden', 'content.json');
    const json = JSON.parse(fs.readFileSync(payload, 'utf8'));
    json.concepts[0].notes = 'tampered';
    fs.writeFileSync(payload, `${JSON.stringify(json, null, 2)}\n`);
    const errors = validateDistribution(dir);
    assert.ok(
      errors.some((e) => e.includes('content_hash')),
      `expected a content_hash error, got: ${errors.join(' | ')}`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a missing manifest reference', () => {
  const dir = cloneGolden();
  try {
    fs.rmSync(path.join(dir, 'chunks', 'de', 'lexicon.de.a1.golden', 'manifest.json'));
    const errors = validateDistribution(dir);
    assert.ok(
      errors.some((e) => e.includes('manifest_path does not resolve')),
      `expected an unresolved manifest error, got: ${errors.join(' | ')}`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
