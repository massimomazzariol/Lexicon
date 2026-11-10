import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { unshippedConcepts } from './finalize_source.mjs';

const pipelineDir = import.meta.dirname;
const sourceDir = path.resolve(pipelineDir, '../../packs/lexicon_source');

function node(script, args) {
  const result = spawnSync(process.execPath, [path.join(pipelineDir, script), ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${script} failed:\n${result.stdout}\n${result.stderr}`);
}

// REGRESSION (2026-11-10): a wave upserted on its own was formless and held by
// the review gate, so Lexicon v0.6.0 shipped without its concepts.
test('a new wave ships only after finalize: forms, gate, runtime pack', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-finalize-'));
  const packDir = path.join(tmp, 'source');
  fs.cpSync(sourceDir, packDir, { recursive: true });
  const entriesPath = path.join(tmp, 'entries.json');
  const conceptId = 'concept-a1-test-rueckwaerts-backwards';
  const word = (lang, text, definition, example) => ({
    lexeme_id: `lex-${lang}-test-${text.replace(/[^a-z]/gi, '')}`,
    text,
    meaning_status: 'exact',
    is_primary: true,
    definition,
    examples: [example],
  });
  fs.writeFileSync(entriesPath, JSON.stringify([{
    source_key: 'test_rueckwaerts',
    concept_id: conceptId,
    pos: 'adv',
    level_auto: 'A1',
    domain_tags: ['Daily'],
    translations: {
      de: word('de', 'rückwärts', 'In die Richtung hinter einem.', 'Das Auto fährt aus der Garage, mit dem Heck zuerst.'),
      it: word('it', "all'indietro", 'Nella direzione alle proprie spalle.', "L'auto esce dal garage con il retro davanti."),
      en: word('en', 'backwards', 'In the direction behind you.', 'The car leaves the garage rear end first.'),
    },
  }]));

  node('upsert_pack_entries.mjs', ['--pack-dir', packDir, '--entries', entriesPath]);
  const read = () => JSON.parse(fs.readFileSync(path.join(packDir, 'content.json'), 'utf8'));
  const before = unshippedConcepts(read(), [conceptId]).map((p) => p.reason);
  assert.ok(before.some((reason) => reason.startsWith('held')), before.join('; '));
  assert.ok(before.some((reason) => reason.startsWith('no forms')), before.join('; '));

  node('finalize_source.mjs', ['--pack-dir', packDir, '--require', entriesPath]);
  assert.deepEqual(unshippedConcepts(read(), [conceptId]), []);

  const destDir = path.join(tmp, 'it_a1');
  node('build_target_pack_from_source.mjs', [
    '--source-pack-dir', packDir, '--dest-pack-dir', destDir, '--pack-id', 'test.it.a1',
    '--target-lang', 'it', '--level', 'A1', '--kind', 'vocab', '--version', '1.0.0',
  ]);
  const runtime = JSON.parse(fs.readFileSync(path.join(destDir, 'content.json'), 'utf8'));
  assert.ok(runtime.concepts.some((row) => row.concept_id === conceptId), 'concept missing from the runtime pack');
  fs.rmSync(tmp, { recursive: true, force: true });
});
