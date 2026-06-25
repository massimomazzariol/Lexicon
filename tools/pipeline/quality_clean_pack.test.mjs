import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inferSurfaceDefiniteness } from '../lib/language_text_conventions.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const qualityToolPath = path.join(
  repoRoot,
  'tools',
  'pipeline',
  'quality_clean_pack.mjs',
);

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function runQualityTool({
  packDir,
  outDir,
  labelLang,
  apply = false,
  generateMissingExamples = false,
}) {
  const args = [
    qualityToolPath,
    '--pack-dir',
    packDir,
    '--out-dir',
    outDir,
  ];
  if (apply) {
    args.push('--apply');
  }
  if (generateMissingExamples) {
    args.push('--generate-missing-examples');
  }
  if (labelLang) {
    args.push('--label-lang', labelLang);
  }

  const stdout = execFileSync(process.execPath, args, {
    cwd: repoRoot,
    stdio: 'pipe',
    encoding: 'utf8',
  });

  const cliSummary = JSON.parse(stdout);
  const report = JSON.parse(fs.readFileSync(cliSummary.reportJsonPath, 'utf8'));
  return {
    cliSummary,
    report,
  };
}

test('quality_clean_pack uses neutral label summaries by default and honors --label-lang when requested', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-quality-'));
  const packDir = path.join(tempRoot, 'lexicon_source');
  const defaultOutDir = path.join(tempRoot, 'reports-default');
  const italianOutDir = path.join(tempRoot, 'reports-it');

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
          lexeme_id: 'lexeme-house-de',
          concept_id: 'concept-house',
          lang: 'de',
          text: 'das Haus',
          is_primary: true,
        },
        {
          lexeme_id: 'lexeme-house-en',
          concept_id: 'concept-house',
          lang: 'en',
          text: 'the house',
          is_primary: true,
        },
        {
          lexeme_id: 'lexeme-house-it',
          concept_id: 'concept-house',
          lang: 'it',
          text: 'la casa',
          is_primary: true,
        },
      ],
      concept_definitions: [
        {
          concept_id: 'concept-house',
          lang: 'de',
          short_definition: 'Gebaeude zum Wohnen.',
          usage_note: null,
          context_tags_json: [],
          source: 'manual',
          synonyms_json: [],
          antonyms_json: [],
          antonym_policy_json: null,
          hint_text: null,
        },
        {
          concept_id: 'concept-house',
          lang: 'en',
          short_definition: 'Building where people live.',
          usage_note: null,
          context_tags_json: [],
          source: 'manual',
          synonyms_json: [],
          antonyms_json: [],
          antonym_policy_json: null,
          hint_text: null,
        },
        {
          concept_id: 'concept-house',
          lang: 'it',
          short_definition: 'Edificio in cui vivono le persone.',
          usage_note: null,
          context_tags_json: [],
          source: 'manual',
          synonyms_json: [],
          antonyms_json: [],
          antonym_policy_json: null,
          hint_text: null,
        },
      ],
      examples: [
        {
          example_id: 'example-house-en',
          concept_id: 'concept-house',
          lang: 'en',
          sentence: 'The family lives in a large building.',
          translation_lang: null,
          translation_text: null,
        },
      ],
    });

    const { report: defaultReport } = runQualityTool({
      packDir,
      outDir: defaultOutDir,
    });
    const { report: italianReport } = runQualityTool({
      packDir,
      outDir: italianOutDir,
      labelLang: 'it',
    });

    const defaultUnresolved = defaultReport.antonym_policy_unresolved[0];
    const italianUnresolved = italianReport.antonym_policy_unresolved[0];

    assert.equal(defaultReport.label_resolution.requested_label_lang, null);
    assert.equal(defaultReport.label_resolution.strategy, 'all_labels_summary');
    assert.equal(defaultUnresolved.label_lang, null);
    assert.equal(defaultUnresolved.label, 'de: das Haus | en: the house | it: la casa');
    assert.deepEqual(defaultUnresolved.labels, {
      de: 'das Haus',
      en: 'the house',
      it: 'la casa',
    });
    assert.equal(Object.hasOwn(defaultUnresolved, 'de'), false);

    assert.equal(italianReport.label_resolution.requested_label_lang, 'it');
    assert.equal(
      italianReport.label_resolution.strategy,
      'preferred_language_with_fallback',
    );
    assert.equal(italianUnresolved.label_lang, 'it');
    assert.equal(italianUnresolved.label, 'la casa');
    assert.deepEqual(italianUnresolved.labels, {
      de: 'das Haus',
      en: 'the house',
      it: 'la casa',
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('quality_clean_pack replaces Context-style placeholder examples during apply', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-quality-'));
  const packDir = path.join(tempRoot, 'lexicon_source');
  const outDir = path.join(tempRoot, 'reports-apply');

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
          concept_id: 'concept-challenge',
          pos: 'noun',
        },
      ],
      lexemes: [
        {
          lexeme_id: 'lexeme-challenge-de',
          concept_id: 'concept-challenge',
          lang: 'de',
          text: 'Herausforderung',
          is_primary: true,
        },
        {
          lexeme_id: 'lexeme-challenge-en',
          concept_id: 'concept-challenge',
          lang: 'en',
          text: 'challenge',
          is_primary: true,
        },
        {
          lexeme_id: 'lexeme-challenge-it',
          concept_id: 'concept-challenge',
          lang: 'it',
          text: 'la sfida',
          is_primary: true,
        },
      ],
      concept_definitions: [
        {
          concept_id: 'concept-challenge',
          lang: 'de',
          short_definition: 'Eine schwierige Aufgabe oder Situation.',
          usage_note: null,
          context_tags_json: [],
          source: 'manual',
          synonyms_json: [],
          antonyms_json: [],
          antonym_policy_json: {
            status: 'intentionally_none',
          },
          hint_text: null,
        },
        {
          concept_id: 'concept-challenge',
          lang: 'en',
          short_definition: 'A difficult task or situation.',
          usage_note: null,
          context_tags_json: [],
          source: 'manual',
          synonyms_json: [],
          antonyms_json: [],
          antonym_policy_json: {
            status: 'intentionally_none',
          },
          hint_text: null,
        },
        {
          concept_id: 'concept-challenge',
          lang: 'it',
          short_definition: 'Un compito o una situazione difficile.',
          usage_note: null,
          context_tags_json: [],
          source: 'manual',
          synonyms_json: [],
          antonyms_json: [],
          antonym_policy_json: {
            status: 'intentionally_none',
          },
          hint_text: null,
        },
      ],
      examples: [
        {
          example_id: 'example-challenge-de',
          concept_id: 'concept-challenge',
          lang: 'de',
          sentence: 'Kontext: Eine schwierige Aufgabe oder Situation.',
          translation_lang: null,
          translation_text: null,
        },
        {
          example_id: 'example-challenge-en',
          concept_id: 'concept-challenge',
          lang: 'en',
          sentence: 'Context: A difficult task or situation.',
          translation_lang: null,
          translation_text: null,
        },
        {
          example_id: 'example-challenge-it',
          concept_id: 'concept-challenge',
          lang: 'it',
          sentence: 'Contesto: Un compito o una situazione difficile.',
          translation_lang: null,
          translation_text: null,
        },
      ],
    });

    const { report, cliSummary } = runQualityTool({
      packDir,
      outDir,
      apply: true,
    });

    assert.equal(report.summary.placeholder_examples_removed, 3);
    assert.equal(report.summary.generated_examples, 0);
    assert.equal(report.summary.example_authoring_requests, 3);
    assert.equal(report.summary.examples_before, 3);
    assert.equal(report.summary.examples_after, 0);
    assert.equal(report.summary.missing_examples, 3);
    assert.match(cliSummary.exampleAuthoringRequestsPath, /example_authoring_requests_/);
    assert.match(cliSummary.exampleAuthoringEntriesPath, /example_authoring_entries_/);

    const cleanedContent = JSON.parse(
      fs.readFileSync(path.join(packDir, 'content.json'), 'utf8'),
    );
    assert.equal(cleanedContent.examples.length, 0);

    const requestEntries = JSON.parse(
      fs.readFileSync(cliSummary.exampleAuthoringRequestsPath, 'utf8'),
    );
    assert.equal(requestEntries.length, 3);
    assert.match(
      requestEntries[0].author_prompt,
      /Write 1 natural no-spoiler example in/,
    );
    const entryTemplates = JSON.parse(
      fs.readFileSync(cliSummary.exampleAuthoringEntriesPath, 'utf8'),
    );
    assert.equal(entryTemplates.length, 3);
    assert.equal(
      entryTemplates[0].translations[requestEntries[0].lang].examples[0].sentence,
      '',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('quality_clean_pack avoids false spoiler hits for short accented Italian forms', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-quality-'));
  const packDir = path.join(tempRoot, 'lexicon_source');
  const outDir = path.join(tempRoot, 'reports-accented');

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
          concept_id: 'concept-there',
          pos: 'adv',
        },
      ],
      lexemes: [
        {
          lexeme_id: 'lexeme-there-it',
          concept_id: 'concept-there',
          lang: 'it',
          text: 'lì',
          pos: 'adv',
          is_primary: true,
        },
        {
          lexeme_id: 'lexeme-there-it-support',
          concept_id: 'concept-there',
          lang: 'it',
          text: 'là',
          pos: 'adv',
          is_primary: false,
        },
      ],
      concept_definitions: [
        {
          concept_id: 'concept-there',
          lang: 'it',
          short_definition: 'In un altro luogo.',
          usage_note: null,
          context_tags_json: [],
          source: 'manual',
          synonyms_json: [],
          antonyms_json: [],
          antonym_policy_json: {
            status: 'intentionally_none',
          },
          hint_text: null,
        },
      ],
      examples: [
        {
          example_id: 'example-there-it',
          concept_id: 'concept-there',
          lang: 'it',
          sentence: "Laggiù c'è la mia auto rossa.",
          translation_lang: null,
          translation_text: null,
        },
      ],
    });

    const { report } = runQualityTool({
      packDir,
      outDir,
    });

    assert.equal(report.summary.spoiler_examples_removed, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('quality_clean_pack can still auto-generate fallback examples when explicitly requested', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-quality-'));
  const packDir = path.join(tempRoot, 'lexicon_source');
  const outDir = path.join(tempRoot, 'reports-apply-generate');

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
          concept_id: 'concept-challenge',
          pos: 'noun',
        },
      ],
      lexemes: [
        {
          lexeme_id: 'lexeme-challenge-en',
          concept_id: 'concept-challenge',
          lang: 'en',
          text: 'challenge',
          is_primary: true,
        },
      ],
      concept_definitions: [
        {
          concept_id: 'concept-challenge',
          lang: 'en',
          short_definition: 'A difficult task or situation.',
          usage_note: null,
          context_tags_json: [],
          source: 'manual',
          synonyms_json: [],
          antonyms_json: [],
          antonym_policy_json: {
            status: 'intentionally_none',
          },
          hint_text: null,
        },
      ],
      examples: [],
    });

    const { report } = runQualityTool({
      packDir,
      outDir,
      apply: true,
      generateMissingExamples: true,
    });

    assert.equal(report.summary.generated_examples, 1);
    assert.equal(report.summary.example_authoring_requests, 1);
    assert.equal(report.summary.examples_after, 1);

    const cleanedContent = JSON.parse(
      fs.readFileSync(path.join(packDir, 'content.json'), 'utf8'),
    );
    assert.equal(cleanedContent.examples[0].sentence, 'Several people calmly talk about the same thing.');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('quality_clean_pack rejects Italian noun support rows that only drop the article', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-quality-'));
  const packDir = path.join(tempRoot, 'lexicon_source');
  const outDir = path.join(tempRoot, 'reports-invalid');

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
          concept_id: 'concept-hour',
          pos: 'noun',
        },
      ],
      lexemes: [
        {
          lexeme_id: 'lexeme-hour-it',
          concept_id: 'concept-hour',
          lang: 'it',
          text: "l'ora",
          pos: 'noun',
          is_primary: true,
        },
      ],
      concept_definitions: [
        {
          concept_id: 'concept-hour',
          lang: 'it',
          short_definition: 'Periodo di sessanta minuti.',
          usage_note: null,
          context_tags_json: [],
          source: 'manual',
          synonyms_json: ['ora'],
          antonyms_json: [],
          antonym_policy_json: {
            status: 'intentionally_none',
          },
          hint_text: null,
        },
      ],
      examples: [],
    });

    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            qualityToolPath,
            '--pack-dir',
            packDir,
            '--out-dir',
            outDir,
          ],
          {
            cwd: repoRoot,
            stdio: 'pipe',
            encoding: 'utf8',
          },
        ),
      /concept_definitions\.synonyms_json/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('quality_clean_pack rejects Italian noun morphology overrides without articles', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-quality-'));
  const packDir = path.join(tempRoot, 'lexicon_source');
  const outDir = path.join(tempRoot, 'reports-invalid');

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
            qualityToolPath,
            '--pack-dir',
            packDir,
            '--out-dir',
            outDir,
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

test('quality_clean_pack rejects English verb support rows that only drop the infinitive marker', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-quality-'));
  const packDir = path.join(tempRoot, 'lexicon_source');
  const outDir = path.join(tempRoot, 'reports-invalid');

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
          concept_id: 'concept-eat',
          pos: 'verb',
        },
      ],
      lexemes: [
        {
          lexeme_id: 'lexeme-eat-en',
          concept_id: 'concept-eat',
          lang: 'en',
          text: 'to eat',
          pos: 'verb',
          is_primary: true,
        },
      ],
      concept_definitions: [
        {
          concept_id: 'concept-eat',
          lang: 'en',
          short_definition: 'To consume food.',
          usage_note: null,
          context_tags_json: [],
          source: 'manual',
          synonyms_json: ['eat'],
          antonyms_json: [],
          antonym_policy_json: {
            status: 'intentionally_none',
          },
          hint_text: null,
        },
      ],
      examples: [],
    });

    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            qualityToolPath,
            '--pack-dir',
            packDir,
            '--out-dir',
            outDir,
          ],
          {
            cwd: repoRoot,
            stdio: 'pipe',
            encoding: 'utf8',
          },
        ),
      /concept_definitions\.synonyms_json/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('source pack keeps Italian noun lexemes and noun forms articleful', () => {
  const content = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, 'packs', 'lexicon_source', 'content.json'),
      'utf8',
    ),
  );
  const lexemes = Array.isArray(content.lexemes) ? content.lexemes : [];
  const lexemeIds = new Set(
    lexemes
      .filter((row) => row?.lang === 'it' && row?.pos === 'noun')
      .map((row) => row.lexeme_id),
  );

  const bareLexemes = lexemes
    .filter((row) => row?.lang === 'it' && row?.pos === 'noun')
    .filter(
      (row) => inferSurfaceDefiniteness(String(row.text ?? ''), 'it') === 'bare',
    )
    .map((row) => row.text);

  const bareForms = (Array.isArray(content.lexeme_forms) ? content.lexeme_forms : [])
    .filter((row) => row?.lang === 'it' && lexemeIds.has(row.lexeme_id))
    .filter(
      (row) =>
        inferSurfaceDefiniteness(String(row.surface ?? ''), 'it') === 'bare',
    )
    .map((row) => row.surface);

  assert.deepEqual(bareLexemes, []);
  assert.deepEqual(bareForms, []);
});
