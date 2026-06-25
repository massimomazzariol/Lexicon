import assert from 'node:assert/strict';
import test from 'node:test';

import { discoverConcepts } from './concept_discovery.mjs';

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
          concept_id: 'concept-pointed',
          pos: 'adj',
          level_auto: 'A2',
          level_override: null,
          domain_tags: ['Daily'],
        },
        {
          concept_id: 'concept-tip',
          pos: 'noun',
          level_auto: 'A2',
          level_override: null,
          domain_tags: ['Daily'],
        },
        {
          concept_id: 'concept-great',
          pos: 'adj',
          level_auto: 'A2',
          level_override: null,
          domain_tags: ['Daily'],
        },
      ],
      lexemes: [
        {
          lexeme_id: 'lex-spitz',
          concept_id: 'concept-pointed',
          lang: 'de',
          text: 'spitz',
          lemma: 'spitz',
          pos: 'adj',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-appuntito',
          concept_id: 'concept-pointed',
          lang: 'it',
          text: 'appuntito',
          lemma: 'appuntito',
          pos: 'adj',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-pointed',
          concept_id: 'concept-pointed',
          lang: 'en',
          text: 'pointed',
          lemma: 'pointed',
          pos: 'adj',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-spitze',
          concept_id: 'concept-tip',
          lang: 'de',
          text: 'Spitze',
          lemma: 'Spitze',
          pos: 'noun',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-tip',
          concept_id: 'concept-tip',
          lang: 'en',
          text: 'the tip',
          lemma: 'tip',
          pos: 'noun',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-punta',
          concept_id: 'concept-tip',
          lang: 'it',
          text: 'la punta',
          lemma: 'punta',
          pos: 'noun',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-grossartig',
          concept_id: 'concept-great',
          lang: 'de',
          text: 'großartig',
          lemma: 'großartig',
          pos: 'adj',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-spitze-col',
          concept_id: 'concept-great',
          lang: 'de',
          text: 'spitze',
          lemma: 'spitze',
          pos: 'adj',
          is_primary: false,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-great',
          concept_id: 'concept-great',
          lang: 'en',
          text: 'great',
          lemma: 'great',
          pos: 'adj',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
      ],
      concept_definitions: [
        {
          concept_id: 'concept-great',
          lang: 'en',
          short_definition: 'Very good.',
          usage_note: null,
          synonyms_json: ['awesome'],
          antonyms_json: ['terrible'],
          antonym_policy_json: null,
          hint_text: null,
        },
      ],
      examples: [
        {
          example_id: 'ex-1',
          concept_id: 'concept-tip',
          lang: 'de',
          sentence: 'Ganz oben am Turm blinkt ein Licht.',
        },
      ],
      lexeme_forms: [
        {
          form_id: 'form-tip',
          lexeme_id: 'lex-tip',
          lang: 'en',
          surface: 'the tip',
          form_role: 'core',
          sort_order: 0,
        },
      ],
    },
  };
}

test('discoverConcepts surfaces exact, close, and split-relevant matches', () => {
  const fixture = buildFixture();
  const summary = discoverConcepts({
    manifest: fixture.manifest,
    content: fixture.content,
    term: 'spitze',
    lang: 'de',
  });

  assert.equal(
    summary.overall_recommendation,
    'multiple_existing_concepts_review_split',
  );

  const conceptIds = summary.concepts.map((row) => row.concept_id);
  assert.ok(conceptIds.includes('concept-tip'));
  assert.ok(conceptIds.includes('concept-great'));
  assert.ok(conceptIds.includes('concept-pointed'));

  const pointed = summary.concepts.find(
    (row) => row.concept_id === 'concept-pointed',
  );
  assert.ok(
    pointed.matches.some((row) => row.match_kind === 'close_lexeme'),
  );
});

test('discoverConcepts surfaces a misspelled term as a close match', () => {
  const fixture = buildFixture();
  const summary = discoverConcepts({
    manifest: fixture.manifest,
    content: fixture.content,
    term: 'grosartig', // typo of großartig (one dropped s after ß->ss folding)
    lang: 'de',
  });

  assert.equal(summary.exact_match_count, 0);
  assert.ok(summary.close_match_count >= 1);
  const great = summary.concepts.find((row) => row.concept_id === 'concept-great');
  assert.ok(great);
  assert.ok(great.matches.some((row) => row.match_kind === 'close_lexeme'));
});

test('discoverConcepts finds support-field hits when no lexeme match exists', () => {
  const fixture = buildFixture();
  const summary = discoverConcepts({
    manifest: fixture.manifest,
    content: fixture.content,
    term: 'awesome',
    lang: 'en',
  });

  assert.equal(
    summary.overall_recommendation,
    'review_support_field_hits_before_creating_new_concept',
  );
  assert.equal(summary.concepts[0].concept_id, 'concept-great');
  assert.ok(
    summary.concepts[0].matches.some((row) => row.match_kind === 'support_exact'),
  );
});
