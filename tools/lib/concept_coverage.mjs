import {
  DEFAULT_LEXICON_LEVEL,
  normalizeLexiconLevel,
} from './lexicon_conventions.mjs';

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeLang(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeLevel(value) {
  return normalizeLexiconLevel(value) ?? DEFAULT_LEXICON_LEVEL;
}

function normalizeOptional(value) {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

function isActiveLexeme(row) {
  if (!row || row.is_active === false) return false;
  return normalizeLang(row.status) !== 'deprecated';
}

function compareLexemes(left, right) {
  if ((left.is_primary === true) !== (right.is_primary === true)) {
    return left.is_primary === true ? -1 : 1;
  }
  const leftMeaning = normalizeLang(left.meaning_status);
  const rightMeaning = normalizeLang(right.meaning_status);
  if ((leftMeaning === 'exact') !== (rightMeaning === 'exact')) {
    return leftMeaning === 'exact' ? -1 : 1;
  }
  return normalizeText(left.text).localeCompare(normalizeText(right.text));
}

function compareConceptRows(left, right) {
  const leftComplete = left.coverage_status === 'complete_core' ? 1 : 0;
  const rightComplete = right.coverage_status === 'complete_core' ? 1 : 0;
  if (leftComplete !== rightComplete) {
    return leftComplete - rightComplete;
  }
  if (left.level !== right.level) {
    return left.level.localeCompare(right.level);
  }
  if (left.pos !== right.pos) {
    return left.pos.localeCompare(right.pos);
  }
  return left.concept_id.localeCompare(right.concept_id);
}

function buildConceptIndex(content) {
  const concepts = Array.isArray(content.concepts) ? content.concepts : [];
  const lexemes = Array.isArray(content.lexemes) ? content.lexemes : [];
  const definitions = Array.isArray(content.concept_definitions)
    ? content.concept_definitions
    : [];
  const examples = Array.isArray(content.examples) ? content.examples : [];
  const forms = Array.isArray(content.lexeme_forms) ? content.lexeme_forms : [];

  const conceptById = new Map(concepts.map((concept) => [concept.concept_id, concept]));
  const lexemeById = new Map();
  const lexemesByConcept = new Map();
  const definitionsByConcept = new Map();
  const examplesByConcept = new Map();
  const formsByConcept = new Map();

  for (const lexeme of lexemes) {
    lexemeById.set(lexeme.lexeme_id, lexeme);
    if (!isActiveLexeme(lexeme)) continue;
    const bucket = lexemesByConcept.get(lexeme.concept_id) ?? [];
    bucket.push(lexeme);
    lexemesByConcept.set(lexeme.concept_id, bucket);
  }

  for (const definition of definitions) {
    const bucket = definitionsByConcept.get(definition.concept_id) ?? [];
    bucket.push(definition);
    definitionsByConcept.set(definition.concept_id, bucket);
  }

  for (const example of examples) {
    const bucket = examplesByConcept.get(example.concept_id) ?? [];
    bucket.push(example);
    examplesByConcept.set(example.concept_id, bucket);
  }

  for (const form of forms) {
    const lexeme = lexemeById.get(form.lexeme_id);
    if (!lexeme || !isActiveLexeme(lexeme)) continue;
    const bucket = formsByConcept.get(lexeme.concept_id) ?? [];
    bucket.push({
      ...form,
      concept_id: lexeme.concept_id,
      lexeme_lang: lexeme.lang,
      lexeme_text: lexeme.text,
      lexeme_lemma: lexeme.lemma,
      lexeme_is_primary: lexeme.is_primary === true,
    });
    formsByConcept.set(lexeme.concept_id, bucket);
  }

  return {
    conceptById,
    lexemesByConcept,
    definitionsByConcept,
    examplesByConcept,
    formsByConcept,
  };
}

function collectLanguages(manifest, content) {
  const manifestLangs = Array.isArray(manifest?.languages_present)
    ? manifest.languages_present
    : [];
  const contentLangs = new Set(
    (Array.isArray(content.lexemes) ? content.lexemes : [])
      .map((row) => normalizeLang(row.lang))
      .filter(Boolean),
  );
  return [...new Set([...manifestLangs.map(normalizeLang), ...contentLangs])].sort();
}

function collectPresenceMap(languages, rows, rowLangGetter, rowValueGetter = null) {
  const map = Object.fromEntries(languages.map((lang) => [lang, false]));
  for (const row of rows) {
    const lang = normalizeLang(rowLangGetter(row));
    if (!lang || !(lang in map)) continue;
    if (typeof rowValueGetter === 'function') {
      const value = rowValueGetter(row);
      if (Array.isArray(value) ? value.length > 0 : Boolean(normalizeOptional(value))) {
        map[lang] = true;
      }
      continue;
    }
    map[lang] = true;
  }
  return map;
}

function collectLexemeSummariesByLang(languages, lexemes) {
  const result = {};
  for (const lang of languages) {
    const rows = lexemes
      .filter((row) => normalizeLang(row.lang) === lang)
      .sort(compareLexemes);
    if (rows.length > 0) {
      result[lang] = rows.map((row) => ({
        lexeme_id: row.lexeme_id,
        text: row.text,
        lemma: row.lemma ?? row.text,
        register: row.register ?? null,
        meaning_status: row.meaning_status ?? null,
        is_primary: row.is_primary === true,
      }));
    }
  }
  return result;
}

function collectDefinitionSummariesByLang(languages, definitions) {
  const result = {};
  for (const lang of languages) {
    const row = definitions.find((definition) => normalizeLang(definition.lang) === lang);
    if (!row) continue;
    result[lang] = {
      short_definition: row.short_definition ?? null,
      usage_note: row.usage_note ?? null,
      synonyms: Array.isArray(row.synonyms_json) ? row.synonyms_json : [],
      antonyms: Array.isArray(row.antonyms_json) ? row.antonyms_json : [],
      antonym_policy: row.antonym_policy_json ?? null,
      hint_text: row.hint_text ?? null,
    };
  }
  return result;
}

function collectExampleSummariesByLang(languages, examples) {
  const result = {};
  for (const lang of languages) {
    const rows = examples
      .filter((row) => normalizeLang(row.lang) === lang)
      .slice(0, 2)
      .map((row) => row.sentence);
    if (rows.length > 0) {
      result[lang] = rows;
    }
  }
  return result;
}

function collectCoreFormsByLang(languages, forms) {
  const result = {};
  for (const lang of languages) {
    const rows = forms
      .filter(
        (row) =>
          normalizeLang(row.lang) === lang &&
          normalizeLang(row.form_role) === 'core',
      )
      .sort((left, right) => {
        if ((left.lexeme_is_primary === true) !== (right.lexeme_is_primary === true)) {
          return left.lexeme_is_primary === true ? -1 : 1;
        }
        return (left.sort_order ?? 0) - (right.sort_order ?? 0);
      })
      .slice(0, 6)
      .map((row) => row.surface);
    if (rows.length > 0) {
      result[lang] = rows;
    }
  }
  return result;
}

function determineCoverageStatus({
  missingLexemeLangs,
  missingDefinitionLangs,
  missingExampleLangs,
  missingCoreFormLangs,
}) {
  if (missingLexemeLangs.length > 0) return 'missing_language_lexicalization';
  if (missingDefinitionLangs.length > 0) return 'missing_definitions';
  if (missingExampleLangs.length > 0) return 'missing_examples';
  if (missingCoreFormLangs.length > 0) return 'missing_core_forms';
  return 'complete_core';
}

function determineRecommendedAction(coverageStatus) {
  switch (coverageStatus) {
    case 'missing_language_lexicalization':
      return 'complete_missing_lexemes';
    case 'missing_definitions':
      return 'complete_missing_definitions';
    case 'missing_examples':
      return 'complete_missing_examples';
    case 'missing_core_forms':
      return 'review_missing_core_forms';
    default:
      return 'concept_complete_review_optional_support';
  }
}

function summarizeConceptCoverage({
  concept,
  languages,
  lexemes,
  definitions,
  examples,
  forms,
}) {
  const lexemesByLang = collectLexemeSummariesByLang(languages, lexemes);
  const definitionsByLang = collectDefinitionSummariesByLang(languages, definitions);
  const exampleSampleByLang = collectExampleSummariesByLang(languages, examples);
  const coreFormsByLang = collectCoreFormsByLang(languages, forms);
  const conceptNeedsCoreForms =
    normalizeLang(concept.pos) === 'noun' ||
    forms.some((row) => normalizeLang(row.form_role) === 'core');

  const matrix = {
    lexemes: collectPresenceMap(languages, lexemes, (row) => row.lang),
    definitions: collectPresenceMap(languages, definitions, (row) => row.lang),
    examples: collectPresenceMap(languages, examples, (row) => row.lang),
    core_forms: Object.fromEntries(
      languages.map((lang) => [
        lang,
        conceptNeedsCoreForms ? Array.isArray(coreFormsByLang[lang]) : false,
      ]),
    ),
    synonyms: collectPresenceMap(
      languages,
      definitions,
      (row) => row.lang,
      (row) => (Array.isArray(row.synonyms_json) ? row.synonyms_json : []),
    ),
    antonyms: collectPresenceMap(
      languages,
      definitions,
      (row) => row.lang,
      (row) => (Array.isArray(row.antonyms_json) ? row.antonyms_json : []),
    ),
    antonym_policy: collectPresenceMap(
      languages,
      definitions,
      (row) => row.lang,
      (row) => normalizeOptional(row.antonym_policy_json),
    ),
  };

  const missingLexemeLangs = languages.filter((lang) => !matrix.lexemes[lang]);
  const missingDefinitionLangs = languages.filter((lang) => !matrix.definitions[lang]);
  const missingExampleLangs = languages.filter((lang) => !matrix.examples[lang]);
  const missingCoreFormLangs = conceptNeedsCoreForms
    ? languages.filter((lang) => matrix.lexemes[lang] && !matrix.core_forms[lang])
    : [];

  const coverageStatus = determineCoverageStatus({
    missingLexemeLangs,
    missingDefinitionLangs,
    missingExampleLangs,
    missingCoreFormLangs,
  });

  return {
    concept_id: concept.concept_id,
    level: normalizeLevel(concept.level_override ?? concept.level_auto),
    pos: normalizeLang(concept.pos),
    domain_tags: Array.isArray(concept.domain_tags) ? concept.domain_tags : [],
    labels: Object.fromEntries(
      Object.entries(lexemesByLang).map(([lang, rows]) => [
        lang,
        rows.find((row) => row.is_primary)?.text ?? rows[0]?.text ?? null,
      ]),
    ),
    coverage_status: coverageStatus,
    recommended_action: determineRecommendedAction(coverageStatus),
    coverage: {
      missing_lexeme_langs: missingLexemeLangs,
      missing_definition_langs: missingDefinitionLangs,
      missing_example_langs: missingExampleLangs,
      missing_core_form_langs: missingCoreFormLangs,
      concept_needs_core_forms: conceptNeedsCoreForms,
    },
    counts: {
      lexemes: lexemes.length,
      definitions: definitions.length,
      examples: examples.length,
      forms: forms.length,
    },
    matrix,
    lexemes_by_lang: lexemesByLang,
    definitions_by_lang: definitionsByLang,
    example_sample_by_lang: exampleSampleByLang,
    core_forms_by_lang: coreFormsByLang,
  };
}

export function buildConceptCoverageMatrix({
  manifest,
  content,
  conceptIds = [],
  level = '',
  pos = '',
  onlyIncomplete = false,
  limit = 25,
}) {
  const languages = collectLanguages(manifest, content);
  const index = buildConceptIndex(content);
  const conceptIdFilter = new Set(
    conceptIds
      .flatMap((value) => String(value ?? '').split(','))
      .map((value) => normalizeOptional(value))
      .filter(Boolean),
  );
  const levelFilter = normalizeOptional(level)?.toUpperCase() ?? '';
  const posFilter = normalizeLang(pos);

  const selectedConcepts = [...index.conceptById.values()].filter((concept) => {
    if (conceptIdFilter.size > 0 && !conceptIdFilter.has(concept.concept_id)) {
      return false;
    }
    if (levelFilter && normalizeLevel(concept.level_override ?? concept.level_auto) !== levelFilter) {
      return false;
    }
    if (posFilter && normalizeLang(concept.pos) !== posFilter) {
      return false;
    }
    return true;
  });

  let concepts = selectedConcepts
    .map((concept) =>
      summarizeConceptCoverage({
        concept,
        languages,
        lexemes: index.lexemesByConcept.get(concept.concept_id) ?? [],
        definitions: index.definitionsByConcept.get(concept.concept_id) ?? [],
        examples: index.examplesByConcept.get(concept.concept_id) ?? [],
        forms: index.formsByConcept.get(concept.concept_id) ?? [],
      }),
    )
    .sort(compareConceptRows);

  if (onlyIncomplete) {
    concepts = concepts.filter((concept) => concept.coverage_status !== 'complete_core');
  }

  const limitedConcepts = concepts.slice(0, Math.max(1, limit));
  const statusCounts = {};
  for (const concept of concepts) {
    statusCounts[concept.coverage_status] = (statusCounts[concept.coverage_status] ?? 0) + 1;
  }

  const missingRequestedConceptIds = [...conceptIdFilter].filter(
    (conceptId) => !index.conceptById.has(conceptId),
  );

  return {
    filters: {
      concept_ids: [...conceptIdFilter],
      missing_requested_concept_ids: missingRequestedConceptIds,
      level: levelFilter || null,
      pos: posFilter || null,
      only_incomplete: onlyIncomplete === true,
      limit: Math.max(1, limit),
    },
    languages,
    totals: {
      matching_concepts: selectedConcepts.length,
      returned_concepts: limitedConcepts.length,
      incomplete_concepts: concepts.filter((concept) => concept.coverage_status !== 'complete_core').length,
      status_counts: statusCounts,
    },
    concepts: limitedConcepts,
  };
}
