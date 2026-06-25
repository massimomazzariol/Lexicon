import { buildConceptCollisionReport } from './concept_collisions.mjs';
import { buildConceptCoverageMatrix } from './concept_coverage.mjs';
import { discoverConcepts } from './concept_discovery.mjs';
import { buildRelatedWordsGuardrails } from './related_word_guardrails.mjs';

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function collectConceptIdsByMatchKinds(discoverySummary, kinds) {
  const allowedKinds = new Set(kinds);
  return uniqueStrings(
    discoverySummary.concepts
      .filter((concept) =>
        concept.matches.some((match) => allowedKinds.has(match.match_kind)),
      )
      .map((concept) => concept.concept_id),
  );
}

function selectCoreConceptIds(discoverySummary, limit) {
  const exact = collectConceptIdsByMatchKinds(discoverySummary, [
    'exact_lexeme',
    'exact_form',
  ]);
  if (exact.length > 0) {
    return exact.slice(0, Math.max(1, limit));
  }

  const support = collectConceptIdsByMatchKinds(discoverySummary, ['support_exact']);
  if (support.length > 0) {
    return support.slice(0, Math.max(1, limit));
  }

  return uniqueStrings(discoverySummary.concepts.map((concept) => concept.concept_id)).slice(
    0,
    Math.max(1, limit),
  );
}

function mapDecisionHint(recommendation) {
  switch (recommendation) {
    case 'multiple_existing_concepts_review_split':
      return {
        decision_hint: 'split_review_required',
        next_step: 'review_multiple_existing_concepts_before_any_pack_edit',
      };
    case 'existing_concept_with_confusable_neighbors':
      return {
        decision_hint: 'existing_concept_with_confusable_neighbors',
        next_step: 'enrich_existing_concept_after_confusable_review',
      };
    case 'existing_concept_found':
      return {
        decision_hint: 'existing_concept_found',
        next_step: 'enrich_existing_concept',
      };
    case 'review_support_field_hits_before_creating_new_concept':
      return {
        decision_hint: 'support_hit_review_required',
        next_step: 'confirm_support_hit_is_not_better_modeled_as_variant',
      };
    case 'likely_new_or_inflected_form_compare_close_matches':
      return {
        decision_hint: 'review_close_matches_before_new_concept',
        next_step: 'check_close_matches_and_normalize_lemma',
      };
    default:
      return {
        decision_hint: 'likely_new_concept',
        next_step: 'propose_new_concept_and_cross_language_lexicalization',
      };
  }
}

function buildAcceptedAnswersAndForms(conceptCoverage) {
  return {
    concept_id: conceptCoverage.concept_id,
    by_lang: Object.fromEntries(
      Object.entries(conceptCoverage.lexemes_by_lang).map(([lang, rows]) => [
        lang,
        {
          primary_lexemes: rows.filter((row) => row.is_primary).map((row) => row.text),
          accepted_lexemes: rows.map((row) => row.text),
          core_forms: conceptCoverage.core_forms_by_lang[lang] ?? [],
        },
      ]),
    ),
  };
}

function buildSupportFields(conceptCoverage) {
  return {
    concept_id: conceptCoverage.concept_id,
    by_lang: Object.fromEntries(
      Object.entries(conceptCoverage.definitions_by_lang).map(([lang, definition]) => [
        lang,
        {
          synonyms: definition.synonyms,
          antonyms: definition.antonyms,
          antonym_policy: definition.antonym_policy,
        },
      ]),
    ),
  };
}

function summarizeCoreConcept(conceptCoverage, discoveryConcept) {
  return {
    concept_id: conceptCoverage.concept_id,
    level: conceptCoverage.level,
    pos: conceptCoverage.pos,
    labels: conceptCoverage.labels,
    precise_meaning_by_lang: Object.fromEntries(
      Object.entries(conceptCoverage.definitions_by_lang).map(([lang, definition]) => [
        lang,
        definition.short_definition,
      ]),
    ),
    coverage_status: conceptCoverage.coverage_status,
    recommended_action: conceptCoverage.recommended_action,
    discovery_matches: discoveryConcept?.matches ?? [],
    same_concept_equivalents: Object.fromEntries(
      Object.entries(conceptCoverage.lexemes_by_lang).map(([lang, rows]) => [
        lang,
        rows.map((row) => row.text),
      ]),
    ),
  };
}

function buildConceptLookup(concepts) {
  return new Map(concepts.map((concept) => [concept.concept_id, concept]));
}

function buildConfusableNeighbors({ coreConceptIds, discoverySummary, collisionSummary, coverageSummary, excludedConceptIds = [] }) {
  const coverageByConcept = buildConceptLookup(coverageSummary.concepts);
  const neighbors = new Map();
  const excluded = new Set(excludedConceptIds);

  for (const concept of discoverySummary.concepts) {
    if (coreConceptIds.includes(concept.concept_id) || excluded.has(concept.concept_id)) continue;
    neighbors.set(concept.concept_id, {
      concept_id: concept.concept_id,
      level: coverageByConcept.get(concept.concept_id)?.level ?? concept.level,
      pos: coverageByConcept.get(concept.concept_id)?.pos ?? concept.pos,
      labels: coverageByConcept.get(concept.concept_id)?.labels ?? concept.labels,
      reason: 'discovery_neighbor',
    });
  }

  for (const overloadedTerm of collisionSummary.overloaded_terms) {
    for (const concept of overloadedTerm.concepts) {
      if (coreConceptIds.includes(concept.concept_id) || excluded.has(concept.concept_id)) continue;
      const existing = neighbors.get(concept.concept_id);
      neighbors.set(concept.concept_id, {
        concept_id: concept.concept_id,
        level: concept.level,
        pos: concept.pos,
        labels: concept.labels,
        reason: existing?.reason ?? overloadedTerm.recommendation,
      });
    }
  }

  for (const pair of collisionSummary.pair_candidates) {
    const involvedCore =
      coreConceptIds.includes(pair.left.concept_id) ||
      coreConceptIds.includes(pair.right.concept_id);
    if (!involvedCore) continue;

    for (const concept of [pair.left, pair.right]) {
      if (coreConceptIds.includes(concept.concept_id) || excluded.has(concept.concept_id)) continue;
      const existing = neighbors.get(concept.concept_id);
      neighbors.set(concept.concept_id, {
        concept_id: concept.concept_id,
        level: concept.level,
        pos: concept.pos,
        labels: concept.labels,
        reason: existing?.reason ?? pair.recommendation,
      });
    }
  }

  return [...neighbors.values()].sort((left, right) =>
    left.concept_id.localeCompare(right.concept_id),
  );
}

export function buildGenerateBrief({
  manifest,
  content,
  term,
  lang = '',
  conceptLimit = 4,
  collisionLimit = 8,
}) {
  const discovery = discoverConcepts({
    manifest,
    content,
    term,
    lang,
    partialLimit: Math.max(4, conceptLimit + 2),
  });
  const decision = mapDecisionHint(discovery.overall_recommendation);
  const coreConceptIds = selectCoreConceptIds(discovery, conceptLimit);
  const supplementalConceptIds = uniqueStrings([
    ...discovery.concepts.map((concept) => concept.concept_id),
    ...coreConceptIds,
  ]);
  const coverage = buildConceptCoverageMatrix({
    manifest,
    content,
    conceptIds: supplementalConceptIds,
    limit: Math.max(1, supplementalConceptIds.length || conceptLimit),
  });
  const collisions = buildConceptCollisionReport({
    manifest,
    content,
    lang,
    term,
    conceptIds: coreConceptIds,
    limit: collisionLimit,
  });

  const coverageByConcept = buildConceptLookup(coverage.concepts);
  const discoveryByConcept = buildConceptLookup(discovery.concepts);

  const coreConcepts = coreConceptIds
    .map((conceptId) => {
      const conceptCoverage = coverageByConcept.get(conceptId);
      if (!conceptCoverage) return null;
      return summarizeCoreConcept(conceptCoverage, discoveryByConcept.get(conceptId));
    })
    .filter(Boolean);

  const acceptedAnswersAndForms = coreConceptIds
    .map((conceptId) => coverageByConcept.get(conceptId))
    .filter(Boolean)
    .map(buildAcceptedAnswersAndForms);

  const examples = coreConceptIds
    .map((conceptId) => coverageByConcept.get(conceptId))
    .filter(Boolean)
    .map((conceptCoverage) => ({
      concept_id: conceptCoverage.concept_id,
      by_lang: conceptCoverage.example_sample_by_lang,
    }));

  const supportFields = coreConceptIds
    .map((conceptId) => coverageByConcept.get(conceptId))
    .filter(Boolean)
    .map(buildSupportFields);

  const relatedWordGuardrails = buildRelatedWordsGuardrails({
    content,
    coreConceptIds,
    discoverySummary: discovery,
    collisionSummary: collisions,
    coverageSummary: coverage,
  });

  const confusableNeighbors = buildConfusableNeighbors({
    coreConceptIds,
    discoverySummary: discovery,
    collisionSummary: collisions,
    coverageSummary: coverage,
    excludedConceptIds: relatedWordGuardrails.nearby_family.map((row) => row.concept_id),
  });

  return {
    input: discovery.input,
    decision_hint: decision.decision_hint,
    next_step: decision.next_step,
    discovery_recommendation: discovery.overall_recommendation,
    core_concept_ids: coreConceptIds,
    template: {
      core_concepts: coreConcepts,
      accepted_answers_and_forms: acceptedAnswersAndForms,
      related_words: {
        same_concept_equivalents: coreConcepts.map((concept) => ({
          concept_id: concept.concept_id,
          by_lang: concept.same_concept_equivalents,
        })),
        nearby_family: relatedWordGuardrails.nearby_family,
        nearby_family_status: relatedWordGuardrails.nearby_family_status,
        nearby_family_hidden_count: relatedWordGuardrails.nearby_family_hidden_count,
        nearby_family_guardrails: relatedWordGuardrails.nearby_family_guardrails,
        confusable_neighbors: confusableNeighbors,
      },
      examples,
      synonyms_antonyms: supportFields,
    },
    diagnostics: {
      discovery,
      coverage,
      collisions,
    },
  };
}
