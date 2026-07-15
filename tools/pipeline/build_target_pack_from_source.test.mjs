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
  'build_target_pack_from_source.mjs',
);
const sourcePackDir = path.join(repoRoot, 'packs', 'lexicon_source');

function buildPack({ targetLang, packId, destPackDir }) {
  execFileSync(
    process.execPath,
    [
      builderPath,
      '--source-pack-dir',
      sourcePackDir,
      '--dest-pack-dir',
      destPackDir,
      '--pack-id',
      packId,
      '--target-lang',
      targetLang,
      '--level',
      'A2',
      '--version',
      'test-version',
      '--generated-at',
      '2026-03-14T00:00:00.000Z',
    ],
    {
      cwd: repoRoot,
      stdio: 'pipe',
    },
  );

  return {
    manifest: JSON.parse(
      fs.readFileSync(path.join(destPackDir, 'manifest.json'), 'utf8'),
    ),
    content: JSON.parse(
      fs.readFileSync(path.join(destPackDir, 'content.json'), 'utf8'),
    ),
  };
}

test('build_target_pack_from_source emits level-scoped delta packs', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lexicon-build-target-pack-'),
  );
  const destPackDir = path.join(tempRoot, 'lexicon_de_a2');

  try {
    const { manifest, content } = buildPack({
      targetLang: 'de',
      packId: 'lexicon.de.a2.seed',
      destPackDir,
    });

    assert.equal(manifest.pack_role, 'runtime');
    assert.deepEqual(manifest.levels_supported, ['A2']);
    assert.deepEqual(manifest.relation_chunk_ids, ['lexicon.de.a1.seed']);
    assert.ok((content.concepts ?? []).length > 0);
    for (const concept of content.concepts ?? []) {
      assert.equal(concept.level_auto, 'A2');
      assert.equal(concept.level_override, null);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('build_target_pack_from_source drops needs_review records (publish gate)', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-build-gate-'));
  const srcDir = path.join(tempRoot, 'source');
  const destDir = path.join(tempRoot, 'lexicon_de_a2');
  fs.mkdirSync(srcDir, { recursive: true });

  const lex = (concept_id, lang, surface) => ({
    lexeme_id: `lx-${concept_id}-${lang}`, concept_id, lang,
    surface, text: surface, lemma: surface, is_primary: true, is_active: true,
  });
  const concept = (concept_id, extra = {}) => ({
    concept_id, pos: 'adj', level_auto: 'A2', level_override: null, domain_tags: [], ...extra,
  });
  const content = {
    concepts: [
      concept('c-keep'),
      concept('c-held', { review_status: 'needs_review' }),
      concept('c-partial'),
    ],
    lexemes: [
      lex('c-keep', 'de', 'klein'), lex('c-keep', 'it', 'piccolo'), lex('c-keep', 'en', 'small'),
      lex('c-held', 'de', 'gross'), lex('c-held', 'it', 'grande'), lex('c-held', 'en', 'big'),
      lex('c-partial', 'de', 'neu'), lex('c-partial', 'it', 'nuovo'), lex('c-partial', 'en', 'new'),
    ],
    lexeme_forms: [],
    examples: [
      { example_id: 'ex-keep', concept_id: 'c-keep', lang: 'de', sentence: 'Das ist klein.' },
      { example_id: 'ex-held', concept_id: 'c-partial', lang: 'de', sentence: 'X', review_status: 'needs_review' },
    ],
    concept_definitions: [
      { concept_id: 'c-keep', lang: 'de', short_definition: 'nicht gross' },
      { concept_id: 'c-partial', lang: 'de', short_definition: 'AI def', source: 'ai', review_status: 'needs_review' },
    ],
    clusters: [],
    cluster_members: [],
  };
  fs.writeFileSync(path.join(srcDir, 'manifest.json'), JSON.stringify({ pack_id: 'lexicon.source.test', pack_role: 'source', license_info: 'internal' }));
  fs.writeFileSync(path.join(srcDir, 'content.json'), JSON.stringify(content));

  try {
    execFileSync(process.execPath, [
      builderPath, '--source-pack-dir', srcDir, '--dest-pack-dir', destDir,
      '--pack-id', 'lexicon.de.a2.seed', '--target-lang', 'de', '--level', 'A2', '--version', 'test',
    ], { cwd: repoRoot, stdio: 'pipe' });

    const out = JSON.parse(fs.readFileSync(path.join(destDir, 'content.json'), 'utf8'));
    const conceptIds = (out.concepts ?? []).map((c) => c.concept_id);
    assert.ok(conceptIds.includes('c-keep'));
    assert.ok(conceptIds.includes('c-partial'));
    assert.ok(!conceptIds.includes('c-held'), 'needs_review concept must be dropped');
    assert.equal((out.lexemes ?? []).filter((l) => l.concept_id === 'c-held').length, 0, 'held concept lexemes must be gone');

    const defCids = (out.concept_definitions ?? []).map((d) => d.concept_id);
    assert.ok(defCids.includes('c-keep'));
    assert.ok(!defCids.includes('c-partial'), 'needs_review definition must be dropped (concept still ships)');

    const exIds = (out.examples ?? []).map((e) => e.example_id);
    assert.ok(exIds.includes('ex-keep'));
    assert.ok(!exIds.includes('ex-held'), 'needs_review example must be dropped');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('build_target tags German verb core forms with decomposition', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-build-verb-'));
  const srcDir = path.join(tempRoot, 'source');
  const destDir = path.join(tempRoot, 'lexicon_de_a2');
  fs.mkdirSync(srcDir, { recursive: true });

  const concept = (id) => ({ concept_id: id, pos: 'verb', level_auto: 'A2', level_override: null, domain_tags: [] });
  const lex = (id, lang, lemma) => ({ lexeme_id: `lx-${id}-${lang}`, concept_id: id, lang, surface: lemma, text: lemma, lemma, pos: 'verb', is_primary: lang === 'de', is_active: true });
  const coreForm = (id, lemma) => ({
    form_id: `f-${id}`, lexeme_id: `lx-${id}-de`, lang: 'de', surface: lemma, surface_search: lemma,
    number_value: 'none', grammatical_case: 'none', definiteness: 'none', form_role: 'core',
    status: 'approved', sort_order: 0, plugin_source: 'core:lexeme-form-generation', tags_json: { slot_key: 'core' },
  });
  const content = {
    concepts: [concept('stehen'), concept('aufstehen')],
    lexemes: [
      lex('stehen', 'de', 'stehen'), lex('stehen', 'it', 'stare'), lex('stehen', 'en', 'stand'),
      lex('aufstehen', 'de', 'aufstehen'), lex('aufstehen', 'it', 'alzarsi'), lex('aufstehen', 'en', 'get up'),
    ],
    lexeme_forms: [coreForm('stehen', 'stehen'), coreForm('aufstehen', 'aufstehen')],
    examples: [], concept_definitions: [], clusters: [], cluster_members: [],
  };
  fs.writeFileSync(path.join(srcDir, 'manifest.json'), JSON.stringify({ pack_id: 'lexicon.source.test', pack_role: 'source', license_info: 'internal' }));
  fs.writeFileSync(path.join(srcDir, 'content.json'), JSON.stringify(content));

  try {
    execFileSync(process.execPath, [
      builderPath, '--source-pack-dir', srcDir, '--dest-pack-dir', destDir,
      '--pack-id', 'lexicon.de.a2.seed', '--target-lang', 'de', '--level', 'A2', '--version', 'test',
    ], { cwd: repoRoot, stdio: 'pipe' });

    const out = JSON.parse(fs.readFileSync(path.join(destDir, 'content.json'), 'utf8'));
    const core = (lexId) => (out.lexeme_forms ?? []).find((f) => f.lexeme_id === lexId && f.tags_json?.slot_key === 'core');

    const auf = core('lx-aufstehen-de');
    assert.ok(auf, 'aufstehen core form ships');
    assert.equal(auf.tags_json.verb_class, 'separable');
    assert.equal(auf.tags_json.prefix, 'auf');
    assert.equal(auf.tags_json.stem, 'stehen'); // validated against the known base verb
    assert.equal(auf.tags_json.aux, 'haben');
    assert.equal(core('lx-stehen-de').tags_json.verb_class, 'simple');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('build_target_pack_from_source uses plugin-backed grammar expansion only where available', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lexicon-build-target-pack-grammar-'),
  );
  const deDestPackDir = path.join(tempRoot, 'lexicon_de_a2');
  const itDestPackDir = path.join(tempRoot, 'lexicon_it_a2');
  const enDestPackDir = path.join(tempRoot, 'lexicon_en_a2');

  try {
    const { content: germanContent } = buildPack({
      targetLang: 'de',
      packId: 'lexicon.de.a2.seed',
      destPackDir: deDestPackDir,
    });
    const { content: englishContent } = buildPack({
      targetLang: 'en',
      packId: 'lexicon.en.a2.seed',
      destPackDir: enDestPackDir,
    });
    const { content: italianContent } = buildPack({
      targetLang: 'it',
      packId: 'lexicon.it.a2.seed',
      destPackDir: itDestPackDir,
    });

    const germanGrammarUnits = (germanContent.study_units ?? []).filter(
      (unit) => unit.unit_kind === 'grammar_prod',
    );
    const italianGrammarUnits = (italianContent.study_units ?? []).filter(
      (unit) => unit.unit_kind === 'grammar_prod',
    );
    const englishGrammarUnits = (englishContent.study_units ?? []).filter(
      (unit) => unit.unit_kind === 'grammar_prod',
    );
    const allPluginSources = [
      ...(germanContent.lexeme_forms ?? []).map((row) => row.plugin_source),
      ...(italianContent.lexeme_forms ?? []).map((row) => row.plugin_source),
      ...(englishContent.lexeme_forms ?? []).map((row) => row.plugin_source),
    ].filter(Boolean);

    assert.ok(germanGrammarUnits.length > 0);
    assert.ok(italianGrammarUnits.length > 0);
    assert.equal(englishGrammarUnits.length, 0);
    assert.equal(
      allPluginSources.some((value) => String(value).startsWith('v2-')),
      false,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('build_target ships concept relations per D7 (either endpoint in the pack)', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lexicon-build-target-pack-relations-'),
  );
  const destPackDir = path.join(tempRoot, 'lexicon_de_a2');

  try {
    const { content } = buildPack({
      targetLang: 'de',
      packId: 'lexicon.de.a2.seed',
      destPackDir,
    });

    assert.ok(Array.isArray(content.concept_relations), 'pack carries concept_relations');
    assert.ok(content.concept_relations.length > 0, 'A2 pack has at least one edge');

    const packConceptIds = new Set(content.concepts.map((c) => c.concept_id));
    for (const edge of content.concept_relations) {
      assert.ok(
        packConceptIds.has(edge.concept_a) || packConceptIds.has(edge.concept_b),
        `edge ${edge.relation_id} has an endpoint in the pack`,
      );
    }

    // The D7 duplication case: a cross-level edge (one endpoint OUTSIDE this
    // pack) still ships here, and stays INERT consumer-side until the other
    // level's chunk arrives. The MT-C5 pilot guarantees at least one:
    // unwichtig (A2) <-> wichtig (A1).
    const crossLevel = content.concept_relations.filter(
      (edge) => !packConceptIds.has(edge.concept_a) || !packConceptIds.has(edge.concept_b),
    );
    assert.ok(crossLevel.length > 0, 'cross-level edges are duplicated into this pack');

    // Shape sanity: ids are deterministic and pairs are ordered.
    for (const edge of content.concept_relations) {
      assert.ok(edge.concept_a < edge.concept_b, 'endpoints are ordered');
      assert.match(edge.relation_id, /^[0-9a-f-]{36}$/);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
