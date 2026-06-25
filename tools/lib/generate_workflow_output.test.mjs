import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGenerateWorkflowActions,
  renderGenerateBriefMarkdown,
  renderGenerateBriefTable,
} from './generate_workflow_output.mjs';

function buildSummaryFixture() {
  return {
    input: {
      term: 'Vergleich',
      lang: 'de',
    },
    decision_hint: 'existing_concept_with_confusable_neighbors',
    next_step: 'enrich_existing_concept_after_confusable_review',
    discovery_recommendation: 'existing_concept_with_confusable_neighbors',
    core_concept_ids: ['concept-compare-noun'],
    template: {
      core_concepts: [
        {
          concept_id: 'concept-compare-noun',
          level: 'A2',
          pos: 'noun',
          labels: {
            de: 'Vergleich',
            en: 'the comparison',
            it: 'il confronto',
          },
          precise_meaning_by_lang: {
            de: 'Das Prufen von Ahnlichkeiten oder Unterschieden.',
            en: 'Checking similarities or differences.',
            it: 'Controllo di somiglianze o differenze.',
          },
          coverage_status: 'missing_examples',
          recommended_action: 'complete_missing_examples',
          discovery_matches: [{ match_kind: 'exact_lexeme' }],
          same_concept_equivalents: {
            de: ['Vergleich'],
            en: ['the comparison'],
            it: ['il confronto'],
          },
        },
      ],
      accepted_answers_and_forms: [
        {
          concept_id: 'concept-compare-noun',
          by_lang: {
            de: {
              primary_lexemes: ['Vergleich'],
              accepted_lexemes: ['Vergleich'],
              core_forms: ['der Vergleich'],
            },
            en: {
              primary_lexemes: ['the comparison'],
              accepted_lexemes: ['the comparison', 'comparison'],
              core_forms: ['the comparison', 'comparison'],
            },
            it: {
              primary_lexemes: ['il confronto'],
              accepted_lexemes: ['il confronto', 'confronto'],
              core_forms: ['il confronto', 'confronto'],
            },
          },
        },
      ],
      related_words: {
        same_concept_equivalents: [
          {
            concept_id: 'concept-compare-noun',
            by_lang: {
              de: ['Vergleich'],
              en: ['the comparison'],
              it: ['il confronto'],
            },
          },
        ],
        nearby_family: [
          {
            concept_id: 'concept-compare-verb',
            level: 'A2',
            pos: 'verb',
            labels: {
              de: 'vergleichen',
              en: 'to compare',
              it: 'confrontare',
            },
            reasons: ['shared_cluster:compare family'],
            shared_domain_tags: ['Abstract', 'Education'],
            shared_clusters: ['compare family'],
          },
        ],
        nearby_family_status: 'auto_bounded',
        nearby_family_hidden_count: 0,
        nearby_family_guardrails: {
          max_items: 4,
        },
        confusable_neighbors: [
          {
            concept_id: 'concept-similar',
            level: 'A2',
            pos: 'adj',
            labels: {
              de: 'ahnlich',
              en: 'similar',
              it: 'simile',
            },
            reason: 'shared_domain_overlap',
          },
        ],
      },
      examples: [
        {
          concept_id: 'concept-compare-noun',
          by_lang: {
            de: ['Mit zwei Angeboten wird die Wahl klarer.'],
            en: ['Two offers make the choice clearer.'],
            it: ['Due offerte rendono la scelta piu chiara.'],
          },
        },
      ],
      synonyms_antonyms: [
        {
          concept_id: 'concept-compare-noun',
          by_lang: {
            de: {
              synonyms: [],
              antonyms: [],
              antonym_policy: 'intentionally_none',
            },
            en: {
              synonyms: [],
              antonyms: [],
              antonym_policy: 'intentionally_none',
            },
            it: {
              synonyms: [],
              antonyms: [],
              antonym_policy: 'intentionally_none',
            },
          },
        },
      ],
    },
  };
}

test('buildGenerateWorkflowActions composes next editorial actions from brief state', () => {
  const actions = buildGenerateWorkflowActions(buildSummaryFixture());

  assert.deepEqual(actions, [
    'enrich_existing_concept_after_confusable_review',
    'concept-compare-noun: complete_missing_examples',
    'keep_confusable_neighbors_separate_during_edit',
  ]);
});

test('renderGenerateBriefMarkdown emits canonical workflow sections', () => {
  const summary = buildSummaryFixture();
  const markdown = renderGenerateBriefMarkdown(summary, {
    pack_id: 'lexicon.source',
    version: 'test',
  });

  assert.match(markdown, /^# Generate Workflow Brief/m);
  assert.match(markdown, /^## Core Concepts$/m);
  assert.match(markdown, /^## Accepted Answers And Forms$/m);
  assert.match(markdown, /^## Related Words$/m);
  assert.match(markdown, /^## Examples$/m);
  assert.match(markdown, /^## Synonyms \/ Antonyms$/m);
  assert.match(markdown, /^## Next Editorial Actions$/m);
  assert.match(markdown, /concept-compare-noun: complete_missing_examples/);
});

test('renderGenerateBriefTable includes editorial actions block', () => {
  const summary = buildSummaryFixture();
  const table = renderGenerateBriefTable(summary, {
    pack_id: 'lexicon.source',
    version: 'test',
  });

  assert.match(table, /^editorial_actions:$/m);
  assert.match(table, /keep_confusable_neighbors_separate_during_edit/);
});
