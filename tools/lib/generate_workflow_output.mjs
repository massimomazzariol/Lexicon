function formatLabels(labels) {
  return ['de', 'en', 'it']
    .map((lang) => `${lang}:${labels?.[lang] ?? '-'}`)
    .join(' | ');
}

function joinValues(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return '-';
  }
  return values.join(', ');
}

function renderCoreConceptTable(concept) {
  const discoveryMatches = Array.isArray(concept.discovery_matches)
    ? concept.discovery_matches.map((row) => row.match_kind)
    : [];
  return [
    `- ${concept.concept_id} [${concept.level} ${concept.pos}]`,
    `  labels: ${formatLabels(concept.labels)}`,
    `  meaning: ${Object.entries(concept.precise_meaning_by_lang)
      .map(([lang, value]) => `${lang}:${value ?? '-'}`)
      .join(' | ')}`,
    `  status: ${concept.coverage_status}`,
    `  action: ${concept.recommended_action}`,
    `  discovery_matches: ${joinValues(discoveryMatches)}`,
  ].join('\n');
}

function renderAcceptedAnswersTable(block) {
  const parts = Object.entries(block.by_lang).map(
    ([lang, value]) =>
      `${lang}: primary=[${joinValues(value.primary_lexemes)}] accepted=[${joinValues(value.accepted_lexemes)}] forms=[${joinValues(value.core_forms)}]`,
  );
  return `- ${block.concept_id}\n  ${parts.join('\n  ')}`;
}

function renderRelatedWordsTable(relatedWords) {
  const nearbyFamily = relatedWords.nearby_family
    .map(
      (row) =>
        `- ${row.concept_id} [${row.level} ${row.pos}] ${formatLabels(row.labels)} (reasons=${joinValues(row.reasons)} tags=${joinValues(row.shared_domain_tags)} clusters=${joinValues(row.shared_clusters)})`,
    )
    .join('\n');
  const sameConcept = relatedWords.same_concept_equivalents
    .map(
      (row) =>
        `- ${row.concept_id}: ${Object.entries(row.by_lang)
          .map(([lang, values]) => `${lang}=[${joinValues(values)}]`)
          .join(' | ')}`,
    )
    .join('\n');
  const confusables = relatedWords.confusable_neighbors
    .map(
      (row) =>
        `- ${row.concept_id} [${row.level} ${row.pos}] ${formatLabels(row.labels)} (${row.reason})`,
    )
    .join('\n');

  return [
    'same_concept_equivalents:',
    sameConcept || 'none',
    `nearby_family_status: ${relatedWords.nearby_family_status}`,
    `nearby_family_hidden_count: ${relatedWords.nearby_family_hidden_count ?? 0}`,
    'nearby_family:',
    nearbyFamily || 'none',
    'confusable_neighbors:',
    confusables || 'none',
  ].join('\n');
}

function renderExamplesTable(examples) {
  if (examples.length === 0) return 'none';
  return examples
    .map(
      (row) =>
        `- ${row.concept_id}\n  ${Object.entries(row.by_lang)
          .map(([lang, values]) => `${lang}: ${joinValues(values)}`)
          .join('\n  ')}`,
    )
    .join('\n');
}

function renderSupportFieldsTable(rows) {
  if (rows.length === 0) return 'none';
  return rows
    .map(
      (row) =>
        `- ${row.concept_id}\n  ${Object.entries(row.by_lang)
          .map(
            ([lang, value]) =>
              `${lang}: syn=[${joinValues(value.synonyms)}] ant=[${joinValues(value.antonyms)}] policy=${formatPolicyValue(value.antonym_policy)}`,
          )
          .join('\n  ')}`,
    )
    .join('\n');
}

function dedupeStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function formatPolicyValue(value) {
  if (!value) {
    return 'none';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return 'configured';
  }
}

export function buildGenerateWorkflowActions(summary) {
  const actions = [];
  if (summary.next_step) {
    actions.push(summary.next_step);
  }

  for (const concept of summary.template.core_concepts ?? []) {
    if (concept.coverage_status !== 'complete_core' && concept.recommended_action) {
      actions.push(`${concept.concept_id}: ${concept.recommended_action}`);
    }
  }

  if (summary.template.related_words?.nearby_family_status === 'manual_review_required') {
    actions.push('review_nearby_family_manually_before_expanding_related_words');
  }

  if ((summary.template.related_words?.confusable_neighbors?.length ?? 0) > 0) {
    actions.push('keep_confusable_neighbors_separate_during_edit');
  }

  if ((summary.core_concept_ids?.length ?? 0) === 0) {
    actions.push('prepare_new_concept_proposal_from_brief');
  }

  if (summary.decision_hint === 'split_review_required') {
    actions.push('preserve_split_between_meanings_before_any_pack_edit');
  }

  return dedupeStrings(actions);
}

function renderMarkdownConcept(concept) {
  const discoveryMatches = Array.isArray(concept.discovery_matches)
    ? concept.discovery_matches.map((row) => row.match_kind)
    : [];
  return [
    `### ${concept.concept_id}`,
    `- Level / POS: \`${concept.level} ${concept.pos}\``,
    `- Labels: ${formatLabels(concept.labels)}`,
    `- Meaning: ${Object.entries(concept.precise_meaning_by_lang)
      .map(([lang, value]) => `${lang}:${value ?? '-'}`)
      .join(' | ')}`,
    `- Coverage status: \`${concept.coverage_status}\``,
    `- Recommended action: \`${concept.recommended_action}\``,
    `- Discovery matches: ${joinValues(discoveryMatches)}`,
  ].join('\n');
}

function renderMarkdownAcceptedAnswers(block) {
  return [
    `### ${block.concept_id}`,
    ...Object.entries(block.by_lang).map(
      ([lang, value]) =>
        `- ${lang}: primary=\`${joinValues(value.primary_lexemes)}\`; accepted=\`${joinValues(value.accepted_lexemes)}\`; forms=\`${joinValues(value.core_forms)}\``,
    ),
  ].join('\n');
}

function renderMarkdownSameConcept(rows) {
  if (rows.length === 0) return '- none';
  return rows
    .map(
      (row) =>
        `- ${row.concept_id}: ${Object.entries(row.by_lang)
          .map(([lang, values]) => `${lang}=[${joinValues(values)}]`)
          .join(' | ')}`,
    )
    .join('\n');
}

function renderMarkdownNearbyFamily(relatedWords) {
  if ((relatedWords.nearby_family?.length ?? 0) === 0) {
    return '- none';
  }

  return relatedWords.nearby_family
    .map(
      (row) =>
        `- ${row.concept_id} [${row.level} ${row.pos}] ${formatLabels(row.labels)}; reasons=${joinValues(row.reasons)}; tags=${joinValues(row.shared_domain_tags)}; clusters=${joinValues(row.shared_clusters)}`,
    )
    .join('\n');
}

function renderMarkdownConfusables(rows) {
  if (rows.length === 0) return '- none';
  return rows
    .map(
      (row) =>
        `- ${row.concept_id} [${row.level} ${row.pos}] ${formatLabels(row.labels)}; reason=${row.reason}`,
    )
    .join('\n');
}

function renderMarkdownExamples(rows) {
  if (rows.length === 0) return '## Examples\n\n- none';
  return [
    '## Examples',
    '',
    ...rows.flatMap((row) => [
      `### ${row.concept_id}`,
      ...Object.entries(row.by_lang).map(
        ([lang, values]) => `- ${lang}: ${joinValues(values)}`,
      ),
      '',
    ]),
  ]
    .join('\n')
    .trimEnd();
}

function renderMarkdownSupportFields(rows) {
  if (rows.length === 0) return '## Synonyms / Antonyms\n\n- none';
  return [
    '## Synonyms / Antonyms',
    '',
    ...rows.flatMap((row) => [
      `### ${row.concept_id}`,
      ...Object.entries(row.by_lang).map(
        ([lang, value]) =>
          `- ${lang}: synonyms=\`${joinValues(value.synonyms)}\`; antonyms=\`${joinValues(value.antonyms)}\`; antonym_policy=\`${formatPolicyValue(value.antonym_policy)}\``,
      ),
      '',
    ]),
  ]
    .join('\n')
    .trimEnd();
}

export function renderGenerateBriefTable(summary, manifest) {
  const actions = buildGenerateWorkflowActions(summary);
  const lines = [
    `pack: ${manifest.pack_id}`,
    `version: ${manifest.version}`,
    `term: ${summary.input.term}`,
    `lang: ${summary.input.lang}`,
    `decision_hint: ${summary.decision_hint}`,
    `next_step: ${summary.next_step}`,
    `discovery_recommendation: ${summary.discovery_recommendation}`,
    `core_concept_ids: ${summary.core_concept_ids.join(', ') || 'none'}`,
    'core_concepts:',
    summary.template.core_concepts.map(renderCoreConceptTable).join('\n') || 'none',
    'accepted_answers_and_forms:',
    summary.template.accepted_answers_and_forms.length > 0
      ? summary.template.accepted_answers_and_forms.map(renderAcceptedAnswersTable).join('\n')
      : 'none',
    'related_words:',
    renderRelatedWordsTable(summary.template.related_words),
    'examples:',
    renderExamplesTable(summary.template.examples),
    'synonyms_antonyms:',
    renderSupportFieldsTable(summary.template.synonyms_antonyms),
    'editorial_actions:',
    actions.length > 0 ? actions.map((row) => `- ${row}`).join('\n') : 'none',
  ];
  return lines.join('\n');
}

export function renderGenerateBriefMarkdown(summary, manifest) {
  const actions = buildGenerateWorkflowActions(summary);
  const relatedWords = summary.template.related_words;
  const coreConcepts = summary.template.core_concepts ?? [];
  const acceptedAnswers = summary.template.accepted_answers_and_forms ?? [];

  return [
    '# Generate Workflow Brief',
    '',
    `- Pack: \`${manifest.pack_id}\``,
    `- Version: \`${manifest.version}\``,
    `- Term: \`${summary.input.term}\``,
    `- Lang: \`${summary.input.lang || '-'}\``,
    `- Decision hint: \`${summary.decision_hint}\``,
    `- Next step: \`${summary.next_step}\``,
    `- Discovery recommendation: \`${summary.discovery_recommendation}\``,
    `- Core concept ids: \`${summary.core_concept_ids.join(', ') || 'none'}\``,
    '',
    '## Core Concepts',
    '',
    coreConcepts.length > 0
      ? coreConcepts.map(renderMarkdownConcept).join('\n\n')
      : '- none',
    '',
    '## Accepted Answers And Forms',
    '',
    acceptedAnswers.length > 0
      ? acceptedAnswers.map(renderMarkdownAcceptedAnswers).join('\n\n')
      : '- none',
    '',
    '## Related Words',
    '',
    '### Same-concept equivalents',
    renderMarkdownSameConcept(relatedWords.same_concept_equivalents ?? []),
    '',
    `### Nearby family (\`${relatedWords.nearby_family_status}\`)`,
    `- Hidden count: \`${relatedWords.nearby_family_hidden_count ?? 0}\``,
    renderMarkdownNearbyFamily(relatedWords),
    '',
    '### Confusable neighbors',
    renderMarkdownConfusables(relatedWords.confusable_neighbors ?? []),
    '',
    renderMarkdownExamples(summary.template.examples ?? []),
    '',
    renderMarkdownSupportFields(summary.template.synonyms_antonyms ?? []),
    '',
    '## Next Editorial Actions',
    '',
    actions.length > 0 ? actions.map((row) => `- \`${row}\``).join('\n') : '- none',
  ]
    .join('\n')
    .trim();
}
