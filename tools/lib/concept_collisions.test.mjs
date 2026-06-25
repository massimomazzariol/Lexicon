import assert from 'node:assert/strict';
import test from 'node:test';

import { buildConceptCollisionReport } from './concept_collisions.mjs';

function buildFixture() {
  return {
    manifest: {
      pack_id: 'lexicon.source',
      version: 'test',
      languages_present: ['de', 'en', 'it'],
    },
    content: {
      concepts: [
        {
          concept_id: 'concept-hour',
          pos: 'noun',
          level_auto: 'A1',
          level_override: null,
          domain_tags: ['Time'],
        },
        {
          concept_id: 'concept-now',
          pos: 'adv',
          level_auto: 'A1',
          level_override: null,
          domain_tags: ['Time'],
        },
        {
          concept_id: 'concept-time-of-day',
          pos: 'noun',
          level_auto: 'A1',
          level_override: null,
          domain_tags: ['Time'],
        },
        {
          concept_id: 'concept-duplicate-a',
          pos: 'noun',
          level_auto: 'A2',
          level_override: null,
          domain_tags: ['Compare'],
        },
        {
          concept_id: 'concept-duplicate-b',
          pos: 'noun',
          level_auto: 'A2',
          level_override: null,
          domain_tags: ['Compare'],
        },
      ],
      lexemes: [
        {
          lexeme_id: 'lex-hour-de',
          concept_id: 'concept-hour',
          lang: 'de',
          text: 'Stunde',
          lemma: 'Stunde',
          pos: 'noun',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-hour-en',
          concept_id: 'concept-hour',
          lang: 'en',
          text: 'the hour',
          lemma: 'hour',
          pos: 'noun',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-hour-it',
          concept_id: 'concept-hour',
          lang: 'it',
          text: "l'ora",
          lemma: 'ora',
          pos: 'noun',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-now-de',
          concept_id: 'concept-now',
          lang: 'de',
          text: 'jetzt',
          lemma: 'jetzt',
          pos: 'adv',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-now-en',
          concept_id: 'concept-now',
          lang: 'en',
          text: 'now',
          lemma: 'now',
          pos: 'adv',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-now-it',
          concept_id: 'concept-now',
          lang: 'it',
          text: 'ora',
          lemma: 'ora',
          pos: 'adv',
          is_primary: false,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-time-de',
          concept_id: 'concept-time-of-day',
          lang: 'de',
          text: 'Uhrzeit',
          lemma: 'Uhrzeit',
          pos: 'noun',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-time-en',
          concept_id: 'concept-time-of-day',
          lang: 'en',
          text: 'the time',
          lemma: 'time',
          pos: 'noun',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-time-it',
          concept_id: 'concept-time-of-day',
          lang: 'it',
          text: "l'ora",
          lemma: 'ora',
          pos: 'noun',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-dup-a-de',
          concept_id: 'concept-duplicate-a',
          lang: 'de',
          text: 'Vergleich',
          lemma: 'Vergleich',
          pos: 'noun',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-dup-a-en',
          concept_id: 'concept-duplicate-a',
          lang: 'en',
          text: 'the comparison',
          lemma: 'comparison',
          pos: 'noun',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-dup-a-it',
          concept_id: 'concept-duplicate-a',
          lang: 'it',
          text: 'il confronto',
          lemma: 'confronto',
          pos: 'noun',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-dup-b-de',
          concept_id: 'concept-duplicate-b',
          lang: 'de',
          text: 'Vergleich',
          lemma: 'Vergleich',
          pos: 'noun',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-dup-b-en',
          concept_id: 'concept-duplicate-b',
          lang: 'en',
          text: 'the comparison',
          lemma: 'comparison',
          pos: 'noun',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-dup-b-it',
          concept_id: 'concept-duplicate-b',
          lang: 'it',
          text: 'la comparazione',
          lemma: 'comparazione',
          pos: 'noun',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
      ],
      lexeme_forms: [
        {
          form_id: 'form-hour-it',
          lexeme_id: 'lex-hour-it',
          lang: 'it',
          surface: 'ora',
          form_role: 'core',
          sort_order: 0,
        },
        {
          form_id: 'form-now-it',
          lexeme_id: 'lex-now-it',
          lang: 'it',
          surface: 'ora',
          form_role: 'core',
          sort_order: 0,
        },
        {
          form_id: 'form-time-it',
          lexeme_id: 'lex-time-it',
          lang: 'it',
          surface: 'ora',
          form_role: 'core',
          sort_order: 0,
        },
      ],
    },
  };
}

test('buildConceptCollisionReport finds overloaded term groups for ora', () => {
  const fixture = buildFixture();
  const summary = buildConceptCollisionReport({
    manifest: fixture.manifest,
    content: fixture.content,
    lang: 'it',
    term: 'ora',
  });

  assert.equal(summary.overloaded_terms.length, 1);
  assert.equal(summary.overloaded_terms[0].normalized_value, 'ora');
  assert.equal(summary.overloaded_terms[0].concept_count, 3);
  assert.equal(
    summary.overloaded_terms[0].recommendation,
    'review_split_for_polysemy',
  );

  const oraPair = summary.pair_candidates.find(
    (pair) =>
      pair.left.concept_id === 'concept-hour' &&
      pair.right.concept_id === 'concept-now',
  );
  assert.ok(oraPair);
  assert.equal(oraPair.recommendation, 'review_split_or_disambiguation');
});

test('buildConceptCollisionReport flags likely duplicate concept pairs across languages', () => {
  const fixture = buildFixture();
  const summary = buildConceptCollisionReport({
    manifest: fixture.manifest,
    content: fixture.content,
    conceptIds: ['concept-duplicate-a', 'concept-duplicate-b'],
    minPairScore: 2,
  });

  assert.equal(summary.overloaded_terms.length >= 2, true);
  assert.equal(summary.pair_candidates.length, 1);
  assert.equal(
    summary.pair_candidates[0].recommendation,
    'review_possible_duplicate_or_merge',
  );
  assert.deepEqual(summary.pair_candidates[0].shared_languages, ['de', 'en']);
});
