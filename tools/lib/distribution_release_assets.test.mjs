import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ASSET_PATH_SEPARATOR,
  flattenDistributionPath,
  planReleaseAssets,
  unflattenAssetName,
} from './distribution_release_assets.mjs';

test('flattens the three distribution shapes', () => {
  assert.equal(flattenDistributionPath('root_manifest.json'), 'root_manifest.json');
  assert.equal(flattenDistributionPath('indexes/de.json'), 'indexes__de.json');
  assert.equal(
    flattenDistributionPath('chunks/de/lexicon.de.a1.seed/content.json'),
    'chunks__de__lexicon.de.a1.seed__content.json',
  );
});

test('accepts OS-native separators', () => {
  assert.equal(
    flattenDistributionPath(path.join('chunks', 'it', 'lexicon.it.b2.seed', 'manifest.json')),
    'chunks__it__lexicon.it.b2.seed__manifest.json',
  );
});

test('round-trips every shape losslessly', () => {
  for (const relPath of [
    'root_manifest.json',
    'indexes/en.json',
    'chunks/en/lexicon.en.b1.seed/content.json',
    'chunks/en/lexicon.en.b1.seed/manifest.json',
  ]) {
    assert.equal(unflattenAssetName(flattenDistributionPath(relPath)), relPath);
  }
});

test('rejects a segment containing the reserved separator', () => {
  assert.throws(
    () => flattenDistributionPath(`chunks/de/lexicon${ASSET_PATH_SEPARATOR}weird/content.json`),
    /reserved separator/,
  );
});

test('rejects an empty path', () => {
  assert.throws(() => flattenDistributionPath(''), /Empty distribution path/);
});

test('planReleaseAssets walks a dist tree and sorts by asset name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-assets-'));
  try {
    fs.mkdirSync(path.join(dir, 'chunks', 'de', 'lexicon.de.a1.seed'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'indexes'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'root_manifest.json'), '{}');
    fs.writeFileSync(path.join(dir, 'indexes', 'de.json'), '{}');
    fs.writeFileSync(
      path.join(dir, 'chunks', 'de', 'lexicon.de.a1.seed', 'content.json'),
      '{}',
    );
    fs.writeFileSync(
      path.join(dir, 'chunks', 'de', 'lexicon.de.a1.seed', 'manifest.json'),
      '{}',
    );

    const plan = planReleaseAssets(dir);
    assert.deepEqual(
      plan.map((entry) => entry.assetName),
      [
        'chunks__de__lexicon.de.a1.seed__content.json',
        'chunks__de__lexicon.de.a1.seed__manifest.json',
        'indexes__de.json',
        'root_manifest.json',
      ],
    );
    assert.deepEqual(
      plan.map((entry) => entry.relPath),
      [
        'chunks/de/lexicon.de.a1.seed/content.json',
        'chunks/de/lexicon.de.a1.seed/manifest.json',
        'indexes/de.json',
        'root_manifest.json',
      ],
    );
    for (const entry of plan) {
      assert.ok(fs.existsSync(entry.absPath));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('planReleaseAssets throws when the dist dir is missing', () => {
  assert.throws(
    () => planReleaseAssets(path.join(os.tmpdir(), 'definitely-not-a-dist-dir-xyz')),
    /Distribution dir not found/,
  );
});
