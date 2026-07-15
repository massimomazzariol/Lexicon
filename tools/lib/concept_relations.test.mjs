import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeRelations,
  applyResolvedEdges,
  rewriteEdgesForMerge,
  lintTransitiveContradictions,
  synonymComponents,
  diagnoseRelations,
  repairRelationOrphans,
  relationId,
  mergeTiers,
  pairKey,
  sortEdges,
} from './concept_relations.mjs';

// Small synthetic lexicon: every triage bucket represented.
function fixture() {
  const concept = (id, level) => ({ concept_id: id, level_auto: level });
  const lexeme = (id, concept_id, lang, text, lemma = text) => ({ lexeme_id: id, concept_id, lang, text, lemma, is_primary: true, is_active: true });
  const def = (concept_id, lang, synonyms, antonyms, tiers) => ({
    concept_id, lang,
    synonyms_json: synonyms, antonyms_json: antonyms,
    ...(tiers ? { synonym_tiers_json: tiers } : {}),
  });
  return {
    concepts: [
      concept('c-haus', 'A1'),
      concept('c-wohnhaus', 'A2'),      // adjacent to c-haus
      concept('c-gebaeude', 'C1'),      // far from c-haus
      concept('c-gross', 'A1'),
      concept('c-klein', 'A1'),
      concept('c-bank-seat', 'A1'),     // ambiguity: two concepts share surface "bank"
      concept('c-bank-money', 'A2'),
    ],
    lexemes: [
      lexeme('lx-haus', 'c-haus', 'de', 'Haus'),
      lexeme('lx-wohnhaus', 'c-wohnhaus', 'de', 'Wohnhaus'),
      lexeme('lx-gebaeude', 'c-gebaeude', 'de', 'Gebaeude'),
      lexeme('lx-gross', 'c-gross', 'de', 'gross'),
      lexeme('lx-klein', 'c-klein', 'de', 'klein'),
      lexeme('lx-bank1', 'c-bank-seat', 'de', 'Bank'),
      lexeme('lx-bank2', 'c-bank-money', 'de', 'Bank'),
      // real data keeps a bare lemma next to an articled text; the elided
      // Italian article does not strip from text, so resolution goes via lemma
      lexeme('lx-casa', 'c-haus', 'it', 'la casa', 'casa'),
      lexeme('lx-abitazione', 'c-wohnhaus', 'it', "l'abitazione", 'abitazione'),
    ],
    concept_definitions: [
      // mutual adjacent synonym pair (de + it evidence), with a tier on one side
      def('c-haus', 'de', ['Wohnhaus'], [], { Wohnhaus: 'exact' }),
      def('c-wohnhaus', 'de', ['Haus'], [], { Haus: 'loose' }),
      def('c-haus', 'it', ['abitazione'], []),
      def('c-wohnhaus', 'it', ['casa'], []),
      // mutual but WIDE span (A1 <-> C1): queue, not auto
      def('c-haus', 'de', ['Gebaeude'], []),
      def('c-gebaeude', 'de', ['Haus'], []),
      // mutual adjacent ANTONYM pair + CONFLICT (klein also listed as synonym by gross)
      def('c-gross', 'de', [], ['klein']),
      def('c-klein', 'de', ['gross'], ['gross']),
      // one-sided synonym; ambiguous ("Bank" -> 2 concepts); dangling in 2 langs;
      // phrase; self-reference
      def('c-gross', 'de', ['Bank', 'riesig', 'sehr gross', 'gross'], []),
      def('c-gross', 'it', ['gigantesco'], []),
    ],
  };
}

test('duplicate definitions per (concept, lang) are fine for analysis input', () => {
  // fixture() intentionally has two de defs for c-haus; analyzeRelations must
  // union their evidence rather than choke.
  const res = analyzeRelations(fixture());
  assert.ok(res.stats.references > 0);
});

test('mutual adjacent pair becomes an auto edge with merged scope and conservative tier', () => {
  const res = analyzeRelations(fixture());
  const syn = res.autoEdges.filter((e) => e.relation_type === 'synonym');
  assert.equal(syn.length, 1);
  const e = syn[0];
  assert.equal(pairKey(e.concept_a, e.concept_b), 'c-haus|c-wohnhaus');
  assert.deepEqual(e.lang_scope_json, ['de', 'it']); // evidence, never null
  assert.equal(e.tier, 'loose'); // exact vs loose -> most conservative
  assert.equal(e.source, 'resolved');
  assert.equal(e.relation_id, relationId('synonym', e.concept_a, e.concept_b));
});

test('conflict pair (synonym AND antonym) produces no edge and lands in the queue', () => {
  const res = analyzeRelations(fixture());
  assert.equal(res.queue.conflicts.length, 1);
  assert.equal(pairKey(res.queue.conflicts[0].concept_a, res.queue.conflicts[0].concept_b), 'c-gross|c-klein');
  // and therefore no antonym auto edge for that pair
  assert.ok(!res.autoEdges.some((e) => pairKey(e.concept_a, e.concept_b) === 'c-gross|c-klein'));
});

test('mutual wide-span pair goes to the wideSpan queue (adjacency rule)', () => {
  const res = analyzeRelations(fixture());
  assert.equal(res.queue.wideSpan.length, 1);
  assert.equal(pairKey(res.queue.wideSpan[0].concept_a, res.queue.wideSpan[0].concept_b), 'c-gebaeude|c-haus');
  assert.equal(res.queue.wideSpan[0].span, 4);
});

test('buckets: ambiguous, dangling (with promotion yield), phrases, self-reference', () => {
  const res = analyzeRelations(fixture());
  assert.equal(res.queue.ambiguous.length, 1);
  assert.equal(res.queue.ambiguous[0].term, 'Bank');
  // riesig (de) + gigantesco (it) both dangle from c-gross: the cross-language
  // group has 2 languages, so both are promotion candidates
  assert.equal(res.dangling.length, 2);
  assert.equal(res.promotionCandidates.length, 2);
  assert.equal(res.phrases.length, 1);
  assert.equal(res.phrases[0].term, 'sehr gross');
  assert.equal(res.selfRef.length, 1);
  assert.equal(res.selfRef[0].term, 'gross');
});

test('applyResolvedEdges is idempotent and never touches manual/ai edges', () => {
  const content = fixture();
  const manual = {
    relation_id: relationId('related', 'c-haus', 'c-wohnhaus'),
    relation_type: 'related',
    concept_a: 'c-haus',
    concept_b: 'c-wohnhaus',
    lang_scope_json: null,
    source: 'manual',
  };
  content.concept_relations = [manual];
  const { autoEdges } = analyzeRelations(content);
  const first = applyResolvedEdges(content, autoEdges);
  // the manual edge covers the pair -> the resolved synonym is skipped (one type per pair)
  assert.equal(first.skippedCovered.length, 1);
  assert.ok(content.concept_relations.includes(manual));
  const after = content.concept_relations.slice();
  const second = applyResolvedEdges(content, analyzeRelations(content).autoEdges);
  assert.deepEqual(content.concept_relations, after); // idempotent
  assert.equal(second.skippedCovered.length, 1);
});

test('rewriteEdgesForMerge retargets, drops self-edges, collapses duplicates', () => {
  const content = fixture();
  content.concept_relations = sortEdges([
    { relation_id: relationId('synonym', 'c-haus', 'c-wohnhaus'), relation_type: 'synonym', concept_a: 'c-haus', concept_b: 'c-wohnhaus', tier: 'close', lang_scope_json: ['de'], source: 'resolved' },
    { relation_id: relationId('synonym', 'c-gebaeude', 'c-wohnhaus'), relation_type: 'synonym', concept_a: 'c-gebaeude', concept_b: 'c-wohnhaus', tier: 'close', lang_scope_json: ['de'], source: 'manual' },
  ]);
  // merge c-gebaeude INTO c-haus: its edge to wohnhaus becomes haus|wohnhaus,
  // colliding with the resolved edge -> collapse keeps the manual one
  const res = rewriteEdgesForMerge(content, 'c-gebaeude', 'c-haus');
  assert.equal(res.rewritten, 1);
  assert.equal(res.droppedSelf, 0);
  assert.equal(res.collapsed, 1);
  assert.equal(content.concept_relations.length, 1);
  assert.equal(content.concept_relations[0].source, 'manual');
  assert.equal(content.concept_relations[0].relation_id, relationId('synonym', 'c-haus', 'c-wohnhaus'));
  // self-edge case: merging one endpoint into the other drops the edge
  const res2 = rewriteEdgesForMerge(content, 'c-wohnhaus', 'c-haus');
  assert.equal(res2.droppedSelf, 1);
  assert.equal(content.concept_relations.length, 0);
});

test('transitive contradiction lint flags A-syn-B-syn-C with A-ant-C', () => {
  const edges = [
    { relation_type: 'synonym', concept_a: 'a', concept_b: 'b' },
    { relation_type: 'synonym', concept_a: 'b', concept_b: 'c' },
    { relation_type: 'antonym', concept_a: 'a', concept_b: 'c' },
  ];
  const flagged = lintTransitiveContradictions(edges);
  assert.equal(flagged.length, 1);
  assert.match(flagged[0], /a\|c \(via b\)/);
  assert.deepEqual(synonymComponents(edges), [['a', 'b', 'c']]);
});

test('diagnoseRelations catches every invariant violation', () => {
  const content = fixture();
  content.concept_relations = [
    // orphan endpoint + wrong id
    { relation_id: 'bogus', relation_type: 'synonym', concept_a: 'c-ghost', concept_b: 'c-haus', tier: 'close', lang_scope_json: ['de'], source: 'resolved' },
    // unordered + tier on antonym + empty lang scope + bad source
    { relation_id: relationId('antonym', 'c-gross', 'c-klein'), relation_type: 'antonym', concept_a: 'c-klein', concept_b: 'c-gross', tier: 'close', lang_scope_json: [], source: 'imported' },
    // wide span (A1 <-> C1) with correct shape otherwise
    { relation_id: relationId('related', 'c-gebaeude', 'c-haus'), relation_type: 'related', concept_a: 'c-gebaeude', concept_b: 'c-haus', lang_scope_json: null, source: 'manual' },
  ];
  const kinds = new Set(diagnoseRelations(content).map((i) => i.kind));
  for (const kind of [
    'relation_orphan', 'relation_unordered', 'relation_bad_id',
    'relation_bad_tier', 'relation_bad_lang_scope', 'relation_bad_source',
    'relation_level_span',
  ]) {
    assert.ok(kinds.has(kind), `expected ${kind}`);
  }
  assert.equal(repairRelationOrphans(content), 1);
  assert.ok(!diagnoseRelations(content).some((i) => i.kind === 'relation_orphan'));
});

test('mergeTiers: most conservative wins, default close', () => {
  assert.equal(mergeTiers(['exact', 'loose']), 'loose');
  assert.equal(mergeTiers(['exact', 'close']), 'close');
  assert.equal(mergeTiers(['exact']), 'exact');
  assert.equal(mergeTiers([]), 'close');
  assert.equal(mergeTiers(['bogus']), 'close');
});
