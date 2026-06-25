import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRelatedWordsGuardrails } from './related_word_guardrails.mjs';

function buildFixture() {
  return {
    content: {
      concepts: [
        {
          concept_id: 'concept-compare-noun',
          pos: 'noun',
          level_auto: 'A2',
          domain_tags: ['Daily', 'Abstract', 'Education'],
        },
        {
          concept_id: 'concept-compare-verb',
          pos: 'verb',
          level_auto: 'A2',
          domain_tags: ['Daily', 'Abstract', 'Education'],
        },
        {
          concept_id: 'concept-great',
          pos: 'adj',
          level_auto: 'A2',
          domain_tags: ['Daily'],
        },
      ],
      lexemes: [
        {
          lexeme_id: 'lex-compare-noun-de',
          concept_id: 'concept-compare-noun',
          lang: 'de',
          text: 'Vergleich',
          lemma: 'Vergleich',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-compare-verb-de',
          concept_id: 'concept-compare-verb',
          lang: 'de',
          text: 'vergleichen',
          lemma: 'vergleichen',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-great-de',
          concept_id: 'concept-great',
          lang: 'de',
          text: 'großartig',
          lemma: 'großartig',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
      ],
      clusters: [
        {
          cluster_id: 'cluster-compare',
          lang: 'de',
          label: 'compare family',
          type: 'semantic',
        },
        {
          cluster_id: 'cluster-confuse',
          lang: 'de',
          label: 'confusable eval',
          type: 'confusables',
        },
      ],
      cluster_members: [
        {
          cluster_id: 'cluster-compare',
          lexeme_id: 'lex-compare-noun-de',
          position: 0,
        },
        {
          cluster_id: 'cluster-compare',
          lexeme_id: 'lex-compare-verb-de',
          position: 1,
        },
        {
          cluster_id: 'cluster-confuse',
          lexeme_id: 'lex-compare-noun-de',
          position: 0,
        },
        {
          cluster_id: 'cluster-confuse',
          lexeme_id: 'lex-great-de',
          position: 1,
        },
      ],
    },
    discoverySummary: {
      concepts: [
        {
          concept_id: 'concept-compare-noun',
          level: 'A2',
          pos: 'noun',
          labels: { de: 'Vergleich', en: 'the comparison', it: 'il confronto' },
          matches: [{ match_kind: 'exact_lexeme' }],
        },
        {
          concept_id: 'concept-compare-verb',
          level: 'A2',
          pos: 'verb',
          labels: { de: 'vergleichen', en: 'to compare', it: 'confrontare' },
          matches: [{ match_kind: 'close_lexeme' }],
        },
        {
          concept_id: 'concept-great',
          level: 'A2',
          pos: 'adj',
          labels: { de: 'großartig', en: 'great', it: 'fantastico' },
          matches: [{ match_kind: 'close_lexeme' }],
        },
      ],
    },
    collisionSummary: {
      overloaded_terms: [],
      pair_candidates: [
        {
          left: { concept_id: 'concept-compare-noun' },
          right: { concept_id: 'concept-great' },
          recommendation: 'review_split_or_disambiguation',
        },
      ],
    },
    coverageSummary: {
      concepts: [
        {
          concept_id: 'concept-compare-noun',
          level: 'A2',
          pos: 'noun',
          domain_tags: ['Daily', 'Abstract', 'Education'],
          labels: { de: 'Vergleich', en: 'the comparison', it: 'il confronto' },
        },
        {
          concept_id: 'concept-compare-verb',
          level: 'A2',
          pos: 'verb',
          domain_tags: ['Daily', 'Abstract', 'Education'],
          labels: { de: 'vergleichen', en: 'to compare', it: 'confrontare' },
        },
        {
          concept_id: 'concept-great',
          level: 'A2',
          pos: 'adj',
          domain_tags: ['Daily'],
          labels: { de: 'großartig', en: 'great', it: 'fantastico' },
        },
      ],
    },
  };
}

test('buildRelatedWordsGuardrails keeps nearby family bounded and excludes collision candidates', () => {
  const fixture = buildFixture();
  const summary = buildRelatedWordsGuardrails({
    content: fixture.content,
    coreConceptIds: ['concept-compare-noun'],
    discoverySummary: fixture.discoverySummary,
    collisionSummary: fixture.collisionSummary,
    coverageSummary: fixture.coverageSummary,
    maxNearbyFamily: 4,
  });

  assert.equal(summary.nearby_family_status, 'auto_bounded');
  assert.equal(summary.nearby_family.length, 1);
  assert.equal(summary.nearby_family[0].concept_id, 'concept-compare-verb');
  assert.ok(summary.nearby_family[0].reasons.includes('shared_cluster:compare family'));
  assert.ok(
    summary.nearby_family_guardrails.excluded_collision_candidates.includes('concept-great'),
  );
});
