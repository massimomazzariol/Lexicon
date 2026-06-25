import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildReleaseCreateArgs,
  buildReleaseUploadArgs,
  stageFlattenedAssets,
} from './publish_distribution_to_release.mjs';

test('buildReleaseCreateArgs always passes --notes (no interactive editor)', () => {
  assert.deepEqual(buildReleaseCreateArgs('dist-2026.06.22'), [
    'release',
    'create',
    'dist-2026.06.22',
    '--notes',
    '',
  ]);
  assert.deepEqual(
    buildReleaseCreateArgs('dist-2026.06.22', { title: 'Lexicon 2026.06.22', notes: 'body' }),
    ['release', 'create', 'dist-2026.06.22', '--title', 'Lexicon 2026.06.22', '--notes', 'body'],
  );
});

test('buildReleaseUploadArgs clobbers by default', () => {
  assert.deepEqual(buildReleaseUploadArgs('t', ['/tmp/a', '/tmp/b']), [
    'release',
    'upload',
    't',
    '/tmp/a',
    '/tmp/b',
    '--clobber',
  ]);
  assert.deepEqual(buildReleaseUploadArgs('t', ['/tmp/a'], { clobber: false }), [
    'release',
    'upload',
    't',
    '/tmp/a',
  ]);
});

test('stageFlattenedAssets copies files under their flattened asset names', () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-src-'));
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-stage-'));
  try {
    const a = path.join(srcDir, 'content.json');
    const b = path.join(srcDir, 'root_manifest.json');
    fs.writeFileSync(a, '{"a":1}');
    fs.writeFileSync(b, '{"b":2}');
    const plan = [
      { absPath: a, relPath: 'chunks/de/lexicon.de.a1.seed/content.json', assetName: 'chunks__de__lexicon.de.a1.seed__content.json' },
      { absPath: b, relPath: 'root_manifest.json', assetName: 'root_manifest.json' },
    ];

    const staged = stageFlattenedAssets(plan, stagingDir);

    assert.deepEqual(staged.map((p) => path.basename(p)).sort(), [
      'chunks__de__lexicon.de.a1.seed__content.json',
      'root_manifest.json',
    ]);
    assert.equal(
      fs.readFileSync(path.join(stagingDir, 'chunks__de__lexicon.de.a1.seed__content.json'), 'utf8'),
      '{"a":1}',
    );
    assert.equal(fs.readFileSync(path.join(stagingDir, 'root_manifest.json'), 'utf8'), '{"b":2}');
  } finally {
    fs.rmSync(srcDir, { recursive: true, force: true });
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
});
