import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const upsertPath = path.join(repoRoot, 'tools', 'pipeline', 'upsert_pack_entries.mjs');

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('upsert_pack_entries delegates German noun ingest fields to the language plugin', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-upsert-'));
  const packDir = path.join(tempRoot, 'lexicon_source');
  const entriesPath = path.join(tempRoot, 'entries.json');

  try {
    fs.mkdirSync(packDir, { recursive: true });
    writeJson(path.join(packDir, 'manifest.json'), {
      pack_id: 'lexicon.source',
      version: 'test-version',
      pack_role: 'source',
    });
    writeJson(path.join(packDir, 'content.json'), {
      concepts: [],
      lexemes: [],
      examples: [],
      concept_definitions: [],
    });
    writeJson(entriesPath, [
      {
        source_key: 'dog_noun',
        pos: 'noun',
        level_auto: 'A1',
        translations: {
          de: {
            text: 'Hund',
            article_nom_sg_def: 'der',
            gender: 'm',
            plural: 'Hunde',
            plural_adds_n_in_dative: false,
            case_overrides: {
              dat_pl: 'Hunden',
            },
          },
          en: {
            text: 'dog',
          },
        },
      },
    ]);

    execFileSync(
      process.execPath,
      [
        upsertPath,
        '--pack-dir',
        packDir,
        '--entries',
        entriesPath,
      ],
      {
        cwd: repoRoot,
        stdio: 'pipe',
      },
    );

    const content = JSON.parse(
      fs.readFileSync(path.join(packDir, 'content.json'), 'utf8'),
    );
    const germanLexeme = content.lexemes.find((row) => row.lang === 'de');
    const englishLexeme = content.lexemes.find((row) => row.lang === 'en');

    assert.ok(germanLexeme);
    assert.equal(germanLexeme.gender, 'masc');
    assert.equal(germanLexeme.article_nom_sg_def, 'der');
    assert.equal(germanLexeme.plural, 'Hunde');
    assert.equal(germanLexeme.n_declension, false);
    assert.equal(germanLexeme.plural_adds_n_in_dative, false);
    assert.deepEqual(germanLexeme.case_overrides_json, {
      dat_pl: 'Hunden',
    });

    assert.ok(englishLexeme);
    assert.equal(Object.hasOwn(englishLexeme, 'article_nom_sg_def'), false);
    assert.equal(Object.hasOwn(englishLexeme, 'plural_adds_n_in_dative'), false);
    assert.equal(Object.hasOwn(englishLexeme, 'case_overrides_json'), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('upsert_pack_entries rejects Italian noun support aliases that only drop the article', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-upsert-'));
  const packDir = path.join(tempRoot, 'lexicon_source');
  const entriesPath = path.join(tempRoot, 'entries.json');

  try {
    fs.mkdirSync(packDir, { recursive: true });
    writeJson(path.join(packDir, 'manifest.json'), {
      pack_id: 'lexicon.source',
      version: 'test-version',
      pack_role: 'source',
    });
    writeJson(path.join(packDir, 'content.json'), {
      concepts: [],
      lexemes: [],
      examples: [],
      concept_definitions: [],
    });
    writeJson(entriesPath, [
      {
        source_key: 'hour_noun',
        pos: 'noun',
        translations: {
          it: {
            text: "l'ora",
            aliases: ['ora'],
          },
          en: {
            text: 'the hour',
          },
        },
      },
    ]);

    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            upsertPath,
            '--pack-dir',
            packDir,
            '--entries',
            entriesPath,
          ],
          {
            cwd: repoRoot,
            stdio: 'pipe',
          },
        ),
      /formatting-only duplicates/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('upsert_pack_entries rejects Italian noun text without article', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-upsert-'));
  const packDir = path.join(tempRoot, 'lexicon_source');
  const entriesPath = path.join(tempRoot, 'entries.json');

  try {
    fs.mkdirSync(packDir, { recursive: true });
    writeJson(path.join(packDir, 'manifest.json'), {
      pack_id: 'lexicon.source',
      version: 'test-version',
      pack_role: 'source',
    });
    writeJson(path.join(packDir, 'content.json'), {
      concepts: [],
      lexemes: [],
      examples: [],
      concept_definitions: [],
    });
    writeJson(entriesPath, [
      {
        source_key: 'house_noun',
        pos: 'noun',
        translations: {
          it: {
            text: 'casa',
          },
          en: {
            text: 'the house',
          },
        },
      },
    ]);

    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            upsertPath,
            '--pack-dir',
            packDir,
            '--entries',
            entriesPath,
          ],
          {
            cwd: repoRoot,
            stdio: 'pipe',
          },
        ),
      /must keep its article/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('upsert_pack_entries rejects English verb aliases that only drop the infinitive marker', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-upsert-'));
  const packDir = path.join(tempRoot, 'lexicon_source');
  const entriesPath = path.join(tempRoot, 'entries.json');

  try {
    fs.mkdirSync(packDir, { recursive: true });
    writeJson(path.join(packDir, 'manifest.json'), {
      pack_id: 'lexicon.source',
      version: 'test-version',
      pack_role: 'source',
    });
    writeJson(path.join(packDir, 'content.json'), {
      concepts: [],
      lexemes: [],
      examples: [],
      concept_definitions: [],
    });
    writeJson(entriesPath, [
      {
        source_key: 'eat_verb',
        pos: 'verb',
        translations: {
          en: {
            text: 'to eat',
            aliases: ['eat'],
          },
          it: {
            text: 'mangiare',
          },
        },
      },
    ]);

    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            upsertPath,
            '--pack-dir',
            packDir,
            '--entries',
            entriesPath,
          ],
          {
            cwd: repoRoot,
            stdio: 'pipe',
          },
        ),
      /formatting-only duplicates/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('upsert_pack_entries preserves review_status on update and stages new concepts', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-upsert-'));
  const packDir = path.join(tempRoot, 'lexicon_source');
  const entriesPath = path.join(tempRoot, 'entries.json');

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
          concept_id: 'concept-a1-shipped',
          pos: 'adj',
          difficulty_score_auto: 20,
          level_auto: 'A1',
          level_override: null,
          domain_tags: ['Daily'],
          notes: null,
          metadata_json: {},
          review_status: 'reviewed',
        },
      ],
      lexemes: [],
      examples: [],
      concept_definitions: [],
    });
    writeJson(entriesPath, [
      {
        concept_id: 'concept-a1-shipped',
        pos: 'adj',
        translations: { en: { text: 'small' } },
      },
      {
        source_key: 'brand_new_adj',
        pos: 'adj',
        translations: { en: { text: 'tiny' } },
      },
    ]);

    execFileSync(
      process.execPath,
      [upsertPath, '--pack-dir', packDir, '--entries', entriesPath],
      { cwd: repoRoot, stdio: 'pipe' },
    );

    const content = JSON.parse(
      fs.readFileSync(path.join(packDir, 'content.json'), 'utf8'),
    );
    const shipped = content.concepts.find(
      (row) => row.concept_id === 'concept-a1-shipped',
    );
    const fresh = content.concepts.find(
      (row) => row.concept_id !== 'concept-a1-shipped',
    );

    assert.equal(shipped.review_status, 'reviewed');
    assert.ok(fresh);
    assert.equal(fresh.review_status, 'needs_review');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('upsert_pack_entries preserves existing lexeme metadata and supports explicit lexeme fields', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-upsert-'));
  const packDir = path.join(tempRoot, 'lexicon_source');
  const entriesPath = path.join(tempRoot, 'entries.json');

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
          concept_id: 'concept-a2-great',
          pos: 'adj',
          difficulty_score_auto: 35,
          level_auto: 'A2',
          level_override: null,
          domain_tags: ['Daily'],
          notes: null,
          metadata_json: {},
        },
      ],
      lexemes: [
        {
          lexeme_id: 'lexeme-de-a2-great',
          concept_id: 'concept-a2-great',
          lang: 'de',
          text: 'großartig',
          lemma: 'großartig',
          pos: 'adj',
          gender: 'none',
          frequency_rank: null,
          countability: 'none',
          register: 'neutral',
          meaning_status: 'exact',
          is_primary: true,
          status: 'approved',
          notes: 'existing-note',
          is_active: true,
        },
      ],
      examples: [],
      concept_definitions: [],
    });
    writeJson(entriesPath, [
      {
        source_key: 'great_topup',
        concept_id: 'concept-a2-great',
        pos: 'adj',
        translations: {
          de: {
            lexeme_id: 'lexeme-de-a2-great',
            text: 'großartig',
            definition: 'Sehr gut oder beeindruckend.',
          },
        },
      },
      {
        source_key: 'great_variant_spitze',
        concept_id: 'concept-a2-great',
        pos: 'adj',
        translations: {
          de: {
            lexeme_id: 'lexeme-de-a2-spitze-colloquial',
            text: 'spitze',
            lemma: 'spitze',
            register: 'colloquial',
            is_primary: false,
            meaning_status: 'exact',
            countability: 'none',
          },
        },
      },
    ]);

    execFileSync(
      process.execPath,
      [
        upsertPath,
        '--pack-dir',
        packDir,
        '--entries',
        entriesPath,
      ],
      {
        cwd: repoRoot,
        stdio: 'pipe',
      },
    );

    const content = JSON.parse(
      fs.readFileSync(path.join(packDir, 'content.json'), 'utf8'),
    );
    const existingLexeme = content.lexemes.find(
      (row) => row.lexeme_id === 'lexeme-de-a2-great',
    );
    const variantLexeme = content.lexemes.find(
      (row) => row.lexeme_id === 'lexeme-de-a2-spitze-colloquial',
    );

    assert.ok(existingLexeme);
    assert.equal(existingLexeme.register, 'neutral');
    assert.equal(existingLexeme.is_primary, true);
    assert.equal(existingLexeme.status, 'approved');
    assert.equal(existingLexeme.notes, 'existing-note');
    assert.equal(existingLexeme.is_active, true);

    assert.ok(variantLexeme);
    assert.equal(variantLexeme.lemma, 'spitze');
    assert.equal(variantLexeme.register, 'colloquial');
    assert.equal(variantLexeme.is_primary, false);
    assert.equal(variantLexeme.meaning_status, 'exact');
    assert.equal(variantLexeme.countability, 'none');
    assert.equal(variantLexeme.status, 'approved');
    assert.equal(variantLexeme.is_active, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
