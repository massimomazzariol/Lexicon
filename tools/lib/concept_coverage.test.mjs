import assert from 'node:assert/strict';
import test from 'node:test';

import { buildConceptCoverageMatrix } from './concept_coverage.mjs';

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
          concept_id: 'concept-complete-noun',
          pos: 'noun',
          level_auto: 'A1',
          level_override: null,
          domain_tags: ['Daily'],
        },
        {
          concept_id: 'concept-missing-example',
          pos: 'adj',
          level_auto: 'A2',
          level_override: null,
          domain_tags: ['Daily'],
        },
        {
          concept_id: 'concept-missing-form',
          pos: 'noun',
          level_auto: 'A2',
          level_override: null,
          domain_tags: ['Daily'],
        },
      ],
      lexemes: [
        {
          lexeme_id: 'lex-complete-de',
          concept_id: 'concept-complete-noun',
          lang: 'de',
          text: 'die Uhr',
          lemma: 'Uhr',
          pos: 'noun',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-complete-en',
          concept_id: 'concept-complete-noun',
          lang: 'en',
          text: 'the clock',
          lemma: 'clock',
          pos: 'noun',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-complete-it',
          concept_id: 'concept-complete-noun',
          lang: 'it',
          text: "l'orologio",
          lemma: 'orologio',
          pos: 'noun',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-adj-de',
          concept_id: 'concept-missing-example',
          lang: 'de',
          text: 'empfindlich',
          lemma: 'empfindlich',
          pos: 'adj',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-adj-en',
          concept_id: 'concept-missing-example',
          lang: 'en',
          text: 'sensitive',
          lemma: 'sensitive',
          pos: 'adj',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-adj-it',
          concept_id: 'concept-missing-example',
          lang: 'it',
          text: 'sensibile',
          lemma: 'sensibile',
          pos: 'adj',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-form-de',
          concept_id: 'concept-missing-form',
          lang: 'de',
          text: 'die Spitze',
          lemma: 'Spitze',
          pos: 'noun',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
        {
          lexeme_id: 'lex-form-en',
          concept_id: 'concept-missing-form',
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
          lexeme_id: 'lex-form-it',
          concept_id: 'concept-missing-form',
          lang: 'it',
          text: 'la punta',
          lemma: 'punta',
          pos: 'noun',
          is_primary: true,
          meaning_status: 'exact',
          status: 'approved',
          is_active: true,
        },
      ],
      concept_definitions: [
        {
          concept_id: 'concept-complete-noun',
          lang: 'de',
          short_definition: 'Zeitmessgeraet.',
          usage_note: null,
          synonyms_json: [],
          antonyms_json: [],
          antonym_policy_json: 'intentionally_none',
          hint_text: null,
        },
        {
          concept_id: 'concept-complete-noun',
          lang: 'en',
          short_definition: 'Timekeeping device.',
          usage_note: null,
          synonyms_json: [],
          antonyms_json: [],
          antonym_policy_json: 'intentionally_none',
          hint_text: null,
        },
        {
          concept_id: 'concept-complete-noun',
          lang: 'it',
          short_definition: 'Strumento per misurare il tempo.',
          usage_note: null,
          synonyms_json: [],
          antonyms_json: [],
          antonym_policy_json: 'intentionally_none',
          hint_text: null,
        },
        {
          concept_id: 'concept-missing-example',
          lang: 'de',
          short_definition: 'Leicht betroffen.',
          usage_note: null,
          synonyms_json: [],
          antonyms_json: [],
          antonym_policy_json: 'intentionally_none',
          hint_text: null,
        },
        {
          concept_id: 'concept-missing-example',
          lang: 'en',
          short_definition: 'Easily affected.',
          usage_note: null,
          synonyms_json: [],
          antonyms_json: [],
          antonym_policy_json: 'intentionally_none',
          hint_text: null,
        },
        {
          concept_id: 'concept-missing-example',
          lang: 'it',
          short_definition: 'Facilmente colpito.',
          usage_note: null,
          synonyms_json: [],
          antonyms_json: [],
          antonym_policy_json: 'intentionally_none',
          hint_text: null,
        },
        {
          concept_id: 'concept-missing-form',
          lang: 'de',
          short_definition: 'Oberes Ende.',
          usage_note: null,
          synonyms_json: [],
          antonyms_json: [],
          antonym_policy_json: 'intentionally_none',
          hint_text: null,
        },
        {
          concept_id: 'concept-missing-form',
          lang: 'en',
          short_definition: 'Upper end.',
          usage_note: null,
          synonyms_json: [],
          antonyms_json: [],
          antonym_policy_json: 'intentionally_none',
          hint_text: null,
        },
        {
          concept_id: 'concept-missing-form',
          lang: 'it',
          short_definition: 'Estremita superiore.',
          usage_note: null,
          synonyms_json: [],
          antonyms_json: [],
          antonym_policy_json: 'intentionally_none',
          hint_text: null,
        },
      ],
      examples: [
        {
          example_id: 'ex-complete-de',
          concept_id: 'concept-complete-noun',
          lang: 'de',
          sentence: 'An der Wand haengt ein altes Geraet.',
        },
        {
          example_id: 'ex-complete-en',
          concept_id: 'concept-complete-noun',
          lang: 'en',
          sentence: 'The old device hangs on the wall.',
        },
        {
          example_id: 'ex-complete-it',
          concept_id: 'concept-complete-noun',
          lang: 'it',
          sentence: 'Il vecchio oggetto e appeso al muro.',
        },
        {
          example_id: 'ex-adj-de',
          concept_id: 'concept-missing-example',
          lang: 'de',
          sentence: 'Seine Haut reagiert schnell auf Kaelte.',
        },
        {
          example_id: 'ex-adj-it',
          concept_id: 'concept-missing-example',
          lang: 'it',
          sentence: 'La sua pelle reagisce subito al freddo.',
        },
        {
          example_id: 'ex-form-de',
          concept_id: 'concept-missing-form',
          lang: 'de',
          sentence: 'Ganz oben blinkt ein Licht.',
        },
        {
          example_id: 'ex-form-en',
          concept_id: 'concept-missing-form',
          lang: 'en',
          sentence: 'A light flashes at the very top.',
        },
        {
          example_id: 'ex-form-it',
          concept_id: 'concept-missing-form',
          lang: 'it',
          sentence: 'In alto lampeggia una luce.',
        },
      ],
      lexeme_forms: [
        {
          form_id: 'form-clock-de',
          lexeme_id: 'lex-complete-de',
          lang: 'de',
          surface: 'die Uhr',
          form_role: 'core',
          sort_order: 0,
        },
        {
          form_id: 'form-clock-en',
          lexeme_id: 'lex-complete-en',
          lang: 'en',
          surface: 'the clock',
          form_role: 'core',
          sort_order: 0,
        },
        {
          form_id: 'form-clock-it',
          lexeme_id: 'lex-complete-it',
          lang: 'it',
          surface: "l'orologio",
          form_role: 'core',
          sort_order: 0,
        },
        {
          form_id: 'form-tip-de',
          lexeme_id: 'lex-form-de',
          lang: 'de',
          surface: 'die Spitze',
          form_role: 'core',
          sort_order: 0,
        },
        {
          form_id: 'form-tip-it',
          lexeme_id: 'lex-form-it',
          lang: 'it',
          surface: 'la punta',
          form_role: 'core',
          sort_order: 0,
        },
      ],
    },
  };
}

test('buildConceptCoverageMatrix surfaces missing examples and missing noun forms', () => {
  const fixture = buildFixture();
  const summary = buildConceptCoverageMatrix({
    manifest: fixture.manifest,
    content: fixture.content,
  });

  assert.equal(summary.totals.matching_concepts, 3);
  assert.equal(summary.totals.incomplete_concepts, 2);

  const missingExample = summary.concepts.find(
    (row) => row.concept_id === 'concept-missing-example',
  );
  assert.equal(missingExample.coverage_status, 'missing_examples');
  assert.deepEqual(missingExample.coverage.missing_example_langs, ['en']);

  const missingForm = summary.concepts.find(
    (row) => row.concept_id === 'concept-missing-form',
  );
  assert.equal(missingForm.coverage_status, 'missing_core_forms');
  assert.deepEqual(missingForm.coverage.missing_core_form_langs, ['en']);
});

test('buildConceptCoverageMatrix supports incomplete-only and concept filters', () => {
  const fixture = buildFixture();
  const summary = buildConceptCoverageMatrix({
    manifest: fixture.manifest,
    content: fixture.content,
    conceptIds: ['concept-complete-noun', 'concept-missing-form'],
    onlyIncomplete: true,
  });

  assert.equal(summary.totals.matching_concepts, 2);
  assert.equal(summary.concepts.length, 1);
  assert.equal(summary.concepts[0].concept_id, 'concept-missing-form');
  assert.equal(summary.concepts[0].coverage_status, 'missing_core_forms');
});
