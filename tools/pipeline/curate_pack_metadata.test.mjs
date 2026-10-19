import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const curatePath = path.join(repoRoot, 'tools', 'pipeline', 'curate_pack_metadata.mjs');

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('REGRESSION: curate keeps clusters and level overrides it does not own', () => {
  // 2026-10-19: curate replaced every cluster with the German plugin's seven
  // (wiping 219 interconnect clusters) and cleared every level_override that
  // was not in the plugin's word table.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-curate-'));
  const packDir = path.join(tempRoot, 'lexicon_source');
  const contentPath = path.join(packDir, 'content.json');

  try {
    fs.mkdirSync(packDir, { recursive: true });
    writeJson(path.join(packDir, 'manifest.json'), {
      pack_id: 'lexicon.source', version: 'test-version', pack_role: 'source',
    });
    const foreignCluster = {
      cluster_id: 'cluster-synonyms-x', lang: 'de', label: 'synonyms: x',
      type: 'semantic', auto: true,
    };
    const foreignMember = { cluster_id: 'cluster-synonyms-x', lexeme_id: 'lex-de-unklar', position: 0 };
    writeJson(contentPath, {
      concepts: [
        { concept_id: 'c-unklar', pos: 'adj', domain_tags: ['Work'], level_auto: 'B2', level_override: 'A2' },
        { concept_id: 'c-irgend', pos: 'chunk', domain_tags: ['Daily'], level_auto: 'A1', level_override: null },
      ],
      lexemes: [
        { lexeme_id: 'lex-de-unklar', concept_id: 'c-unklar', lang: 'de', text: 'unklar', lemma: 'unklar' },
        { lexeme_id: 'lex-de-irgend', concept_id: 'c-irgend', lang: 'de', text: 'irgendetwas', lemma: 'irgendetwas' },
      ],
      concept_definitions: [],
      examples: [],
      clusters: [foreignCluster],
      cluster_members: [foreignMember],
    });

    execFileSync(process.execPath, [curatePath, '--pack-dir', packDir], {
      cwd: repoRoot, stdio: 'pipe', encoding: 'utf8',
    });

    const after = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
    const concept = (id) => after.concepts.find((row) => row.concept_id === id);
    assert.equal(concept('c-unklar').level_override, 'A2', 'an override set elsewhere survives');
    assert.equal(concept('c-irgend').level_override, 'A2', 'the plugin table still applies');
    assert.deepEqual(after.clusters.find((row) => row.cluster_id === 'cluster-synonyms-x'), foreignCluster);
    assert.ok(after.cluster_members.some((row) => row.cluster_id === 'cluster-synonyms-x'));
    assert.ok(after.clusters.some((row) => row.label === 'irgend-forms'), 'plugin clusters are added');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
