import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const builderPath = path.join(
  repoRoot,
  'tools',
  'pipeline',
  'build_lexicon_distribution.mjs',
);

test('build_lexicon_distribution exports runtime packs as artifact-ready files', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lexicon-lexicon-distribution-'),
  );
  const outDir = path.join(tempRoot, 'dist');

  try {
    execFileSync(
      process.execPath,
      [
        builderPath,
        '--packs-root',
        path.join(repoRoot, 'packs'),
        '--out-dir',
        outDir,
        '--generated-at',
        '2026-03-19T00:00:00.000Z',
      ],
      {
        cwd: repoRoot,
        stdio: 'pipe',
      },
    );

    const rootManifest = JSON.parse(
      fs.readFileSync(path.join(outDir, 'root_manifest.json'), 'utf8'),
    );
    const deIndex = JSON.parse(
      fs.readFileSync(path.join(outDir, 'indexes', 'de.json'), 'utf8'),
    );
    const deA2Manifest = JSON.parse(
      fs.readFileSync(
        path.join(outDir, 'chunks', 'de', 'lexicon.de.a2.seed', 'manifest.json'),
        'utf8',
      ),
    );

    assert.equal(rootManifest.contract_version, '0.1.0');
    assert.equal(rootManifest.generated_at, '2026-03-19T00:00:00.000Z');
    assert.deepEqual(
      rootManifest.language_indexes.map((entry) => entry.language_code).sort(),
      ['de', 'en', 'it'],
    );

    assert.equal(deIndex.language_code, 'de');
    assert.equal(deIndex.generated_at, '2026-03-19T00:00:00.000Z');
    assert.deepEqual(
      deIndex.chunks.map((entry) => entry.chunk_id),
      [
        'lexicon.de.a1.expressions',
        'lexicon.de.a1.seed',
        'lexicon.de.a2.expressions',
        'lexicon.de.a2.seed',
        'lexicon.de.b1.expressions',
        'lexicon.de.b1.seed',
        'lexicon.de.b2.expressions',
        'lexicon.de.b2.seed',
      ],
    );

    // Each chunk pointer carries its content kind so the app can filter downloads
    // (vocab by default; expressions opt-in) without fetching every chunk manifest.
    for (const chunk of deIndex.chunks) {
      const expectedKind = chunk.chunk_id.endsWith('.expressions')
        ? 'expressions'
        : 'vocab';
      assert.equal(chunk.kind, expectedKind, `kind for ${chunk.chunk_id}`);
    }

    assert.equal(deA2Manifest.pack_id, 'lexicon.de.a2.seed');
    assert.equal(deA2Manifest.chunk_id, 'lexicon.de.a2.seed');
    assert.equal(deA2Manifest.language_code, 'de');
    assert.equal(
      deA2Manifest.payload_path,
      'chunks/de/lexicon.de.a2.seed/content.json',
    );
    assert.deepEqual(deA2Manifest.levels_supported, ['A2']);
    assert.deepEqual(deA2Manifest.relation_chunk_ids, ['lexicon.de.a1.seed']);
    assert.equal(deA2Manifest.schema_version, 2);
    assert.ok(String(deA2Manifest.content_hash).startsWith('sha256:'));
    assert.equal(
      fs.existsSync(
        path.join(outDir, 'chunks', 'de', 'lexicon.source', 'manifest.json'),
      ),
      false,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
