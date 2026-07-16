import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const generatePath = path.join(
  repoRoot,
  'tools',
  'pipeline',
  'generate_pack_forms.mjs',
);

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('form_id is keyed on the slot, not the surface - survives a surface edit', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-v2-formid-'));
  const packDir = path.join(tempRoot, 'lexicon_source');
  const contentPath = path.join(packDir, 'content.json');
  const slotOf = (f) => f?.tags_json?.slot_key;
  const build = () =>
    execFileSync(process.execPath, [generatePath, '--pack-dir', packDir], {
      cwd: repoRoot, stdio: 'pipe', encoding: 'utf8',
    });
  const nomSgDef = () =>
    JSON.parse(fs.readFileSync(contentPath, 'utf8')).lexeme_forms.find(
      (f) => f.lexeme_id === 'lex-de-lauf' && slotOf(f) === 'nom_sg_def',
    );

  try {
    fs.mkdirSync(packDir, { recursive: true });
    writeJson(path.join(packDir, 'manifest.json'), {
      pack_id: 'lexicon.source', version: 'test-version', pack_role: 'source',
    });
    writeJson(path.join(packDir, 'lexeme_morphology_overrides.json'), {
      schema_version: 1, lexeme_overrides: {},
    });
    writeJson(contentPath, {
      concepts: [{ concept_id: 'c-lauf', pos: 'noun' }],
      lexemes: [{
        lexeme_id: 'lex-de-lauf', concept_id: 'c-lauf', lang: 'de',
        text: 'Lauf', lemma: 'Lauf', pos: 'noun', gender: 'masc', is_primary: true,
      }],
      concept_definitions: [], examples: [],
    });

    build();
    const before = nomSgDef();
    assert.ok(before, 'nom_sg_def form is generated');

    // Change the surface (derived form goes "der Lauf" → "der Laufweg") for the SAME lexeme
    // + slot. Clear lexeme_forms so the id is minted fresh from the seed (no reuse shortcut) -
    // this is what proves the seed itself no longer depends on the surface.
    const data = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
    data.lexemes[0].text = 'Laufweg';
    data.lexemes[0].lemma = 'Laufweg';
    data.lexeme_forms = [];
    writeJson(contentPath, data);

    build();
    const after = nomSgDef();
    assert.ok(after, 'nom_sg_def form is regenerated');
    assert.notEqual(after.surface, before.surface, 'sanity: the surface actually changed');
    assert.equal(after.form_id, before.form_id, 'form_id is stable across the surface edit');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generate_pack_forms rejects Italian noun overrides without articles', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-v2-nouns-'));
  const packDir = path.join(tempRoot, 'lexicon_source');

  try {
    fs.mkdirSync(packDir, { recursive: true });
    writeJson(path.join(packDir, 'manifest.json'), {
      pack_id: 'lexicon.source',
      version: 'test-version',
      pack_role: 'source',
    });
    writeJson(path.join(packDir, 'content.json'), {
      concepts: [
        {
          concept_id: 'concept-house',
          pos: 'noun',
        },
      ],
      lexemes: [
        {
          lexeme_id: 'lexeme-house-it',
          concept_id: 'concept-house',
          lang: 'it',
          text: 'la casa',
          pos: 'noun',
          is_primary: true,
        },
      ],
      concept_definitions: [],
      examples: [],
    });
    writeJson(path.join(packDir, 'lexeme_morphology_overrides.json'), {
      schema_version: 1,
      lexeme_overrides: {
        'lexeme-house-it': {
          forms: {
            pl_core: 'case',
          },
        },
      },
    });

    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            generatePath,
            '--pack-dir',
            packDir,
            '--dry-run',
          ],
          {
            cwd: repoRoot,
            stdio: 'pipe',
            encoding: 'utf8',
          },
        ),
      /lexeme_morphology_overrides\.forms\.pl_core/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('REGRESSION: generate_pack_forms preserves the concept_relations graph', () => {
  // 2026-07-16: a leftover legacy purge line (`delete content.concept_relations`)
  // silently wiped the MT-C5 graph on the first pipeline run after its
  // introduction. The array must survive every regeneration.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-v2-relations-'));
  const packDir = path.join(tempRoot, 'lexicon_source');
  const contentPath = path.join(packDir, 'content.json');

  try {
    fs.mkdirSync(packDir, { recursive: true });
    writeJson(path.join(packDir, 'manifest.json'), {
      pack_id: 'lexicon.source', version: 'test-version', pack_role: 'source',
    });
    writeJson(path.join(packDir, 'lexeme_morphology_overrides.json'), {
      schema_version: 1, lexeme_overrides: {},
    });
    const edge = {
      relation_id: 'rel-test-a-b',
      relation_type: 'synonym',
      concept_a: 'c-a',
      concept_b: 'c-b',
      tier: 'close',
      lang_scope_json: ['de'],
      source: 'resolved',
    };
    writeJson(contentPath, {
      concepts: [
        { concept_id: 'c-a', pos: 'noun' },
        { concept_id: 'c-b', pos: 'noun' },
      ],
      lexemes: [{
        lexeme_id: 'lex-de-a', concept_id: 'c-a', lang: 'de',
        text: 'Lauf', lemma: 'Lauf', pos: 'noun', gender: 'masc', is_primary: true,
      }],
      concept_definitions: [], examples: [],
      concept_relations: [edge],
    });

    execFileSync(process.execPath, [generatePath, '--pack-dir', packDir], {
      cwd: repoRoot, stdio: 'pipe', encoding: 'utf8',
    });

    const after = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
    assert.deepEqual(after.concept_relations, [edge], 'the graph survives generation');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
