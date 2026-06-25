import {
  DEFAULT_LEXICON_LEVEL,
  normalizeLexiconLevel,
} from './lexicon_conventions.mjs';
import { isTypoNeighbor } from './edit_distance.mjs';

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeOptional(value) {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

function normalizeLang(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeSearchValue(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\u00df/g, 'ss')
    .replace(/[\u2019\u2018`\u00b4]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeSearchValue(value) {
  return normalizeSearchValue(value)
    .replace(/'/g, ' ')
    .split(/[^a-z0-9]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function isCloseSearchMatch(candidate, search) {
  if (!candidate || !search || candidate === search) {
    return false;
  }
  if (
    Math.min(candidate.length, search.length) >= 3 &&
    (candidate.startsWith(search) || search.startsWith(candidate))
  ) {
    return true;
  }
  // Whole-string typo (e.g. "machne" ~ "machen") so misspellings still surface
  // the existing entry instead of looking like a brand-new word.
  if (isTypoNeighbor(candidate, search)) {
    return true;
  }
  const candidateTokens = tokenizeSearchValue(candidate);
  const searchTokens = tokenizeSearchValue(search);
  for (const candidateToken of candidateTokens) {
    for (const searchToken of searchTokens) {
      if (
        !candidateToken ||
        !searchToken ||
        candidateToken === searchToken ||
        Math.min(candidateToken.length, searchToken.length) < 3
      ) {
        continue;
      }
      if (
        candidateToken.startsWith(searchToken) ||
        searchToken.startsWith(candidateToken) ||
        isTypoNeighbor(candidateToken, searchToken)
      ) {
        return true;
      }
    }
  }
  return false;
}

function normalizeLevel(value) {
  return normalizeLexiconLevel(value) ?? DEFAULT_LEXICON_LEVEL;
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

function compareMatches(left, right) {
  if (left.score !== right.score) {
    return right.score - left.score;
  }
  if (left.match_kind !== right.match_kind) {
    return left.match_kind.localeCompare(right.match_kind);
  }
  if (left.lang !== right.lang) {
    return left.lang.localeCompare(right.lang);
  }
  return normalizeText(left.value).localeCompare(normalizeText(right.value));
}

function pushMatch(bucket, nextMatch) {
  const dedupeKey = [
    nextMatch.concept_id,
    nextMatch.match_kind,
    nextMatch.field,
    nextMatch.lang,
    normalizeSearchValue(nextMatch.value),
  ].join('|');
  if (bucket.some((row) => row.dedupe_key === dedupeKey)) {
    return;
  }
  bucket.push({
    ...nextMatch,
    dedupe_key: dedupeKey,
  });
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
  const lexemesByConcept = new Map();
  const definitionsByConcept = new Map();
  const examplesByConcept = new Map();
  const formsByConcept = new Map();
  const lexemeById = new Map();

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
  const langs = [...new Set([...manifestLangs.map(normalizeLang), ...contentLangs])];
  return langs.sort();
}

function summarizeConcept({
  concept,
  languages,
  lexemes,
  definitions,
  examples,
  forms,
  matches,
}) {
  const lexemesByLang = {};
  for (const lang of languages) {
    const rows = lexemes
      .filter((row) => normalizeLang(row.lang) === lang)
      .sort(compareLexemes);
    if (rows.length > 0) {
      lexemesByLang[lang] = rows.map((row) => ({
        lexeme_id: row.lexeme_id,
        text: row.text,
        lemma: row.lemma ?? row.text,
        register: row.register ?? null,
        meaning_status: row.meaning_status ?? null,
        is_primary: row.is_primary === true,
      }));
    }
  }

  const definitionsByLang = {};
  for (const definition of definitions) {
    const lang = normalizeLang(definition.lang);
    definitionsByLang[lang] = {
      short_definition: definition.short_definition ?? null,
      usage_note: definition.usage_note ?? null,
      synonyms: Array.isArray(definition.synonyms_json)
        ? definition.synonyms_json
        : [],
      antonyms: Array.isArray(definition.antonyms_json)
        ? definition.antonyms_json
        : [],
      antonym_policy: definition.antonym_policy_json ?? null,
      hint_text: definition.hint_text ?? null,
    };
  }

  const exampleSampleByLang = {};
  for (const lang of languages) {
    const rows = examples
      .filter((row) => normalizeLang(row.lang) === lang)
      .slice(0, 2)
      .map((row) => row.sentence);
    if (rows.length > 0) {
      exampleSampleByLang[lang] = rows;
    }
  }

  const coreFormsByLang = {};
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
      .slice(0, 4)
      .map((row) => row.surface);
    if (rows.length > 0) {
      coreFormsByLang[lang] = rows;
    }
  }

  const missingLexemeLangs = languages.filter((lang) => !lexemesByLang[lang]);
  const missingDefinitionLangs = languages.filter((lang) => !definitionsByLang[lang]);
  const missingExampleLangs = languages.filter((lang) => !exampleSampleByLang[lang]);

  let coverage_status = 'complete_core';
  if (missingLexemeLangs.length > 0) {
    coverage_status = 'missing_language_lexicalization';
  } else if (missingDefinitionLangs.length > 0) {
    coverage_status = 'missing_definitions';
  } else if (missingExampleLangs.length > 0) {
    coverage_status = 'missing_examples';
  }

  let recommended_action = 'inspect_existing_concept';
  if (missingLexemeLangs.length > 0 || missingDefinitionLangs.length > 0 || missingExampleLangs.length > 0) {
    recommended_action = 'enrich_existing_concept';
  } else if (matches.some((row) => row.match_kind === 'support_exact')) {
    recommended_action = 'review_existing_concept_for_variant_or_synonym';
  }

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
    matches: matches.map(({ dedupe_key, score, normalized_value, ...row }) => row),
    coverage_status,
    recommended_action,
    coverage: {
      missing_lexeme_langs: missingLexemeLangs,
      missing_definition_langs: missingDefinitionLangs,
      missing_example_langs: missingExampleLangs,
    },
    lexemes_by_lang: lexemesByLang,
    definitions_by_lang: definitionsByLang,
    example_sample_by_lang: exampleSampleByLang,
    core_forms_by_lang: coreFormsByLang,
  };
}

function buildOverallRecommendation(exactConceptIds, supportConceptIds, closeConceptIds) {
  if (exactConceptIds.size > 1) {
    return 'multiple_existing_concepts_review_split';
  }
  if (exactConceptIds.size === 1 && closeConceptIds.size > 1) {
    return 'existing_concept_with_confusable_neighbors';
  }
  if (exactConceptIds.size === 1) {
    return 'existing_concept_found';
  }
  if (supportConceptIds.size > 0) {
    return 'review_support_field_hits_before_creating_new_concept';
  }
  if (closeConceptIds.size > 0) {
    return 'likely_new_or_inflected_form_compare_close_matches';
  }
  return 'likely_new_concept';
}

export function discoverConcepts({
  manifest,
  content,
  term,
  lang = '',
  partialLimit = 8,
}) {
  const normalizedTerm = normalizeOptional(term);
  if (!normalizedTerm) {
    throw new Error('discoverConcepts requires a non-empty term.');
  }

  const langFilter = normalizeLang(lang);
  const search = normalizeSearchValue(normalizedTerm);
  const languages = collectLanguages(manifest, content);
  const index = buildConceptIndex(content);
  const exactMatches = [];
  const supportMatches = [];
  const closeMatches = [];

  for (const [conceptId, concept] of index.conceptById.entries()) {
    const lexemes = index.lexemesByConcept.get(conceptId) ?? [];
    const definitions = index.definitionsByConcept.get(conceptId) ?? [];
    const forms = index.formsByConcept.get(conceptId) ?? [];

    for (const lexeme of lexemes) {
      const rowLang = normalizeLang(lexeme.lang);
      if (langFilter && rowLang !== langFilter) continue;

      const textValue = normalizeSearchValue(lexeme.text);
      const lemmaValue = normalizeSearchValue(lexeme.lemma ?? lexeme.text);

      if (textValue === search) {
        pushMatch(exactMatches, {
          concept_id: conceptId,
          concept_level: normalizeLevel(concept.level_override ?? concept.level_auto),
          concept_pos: normalizeLang(concept.pos),
          match_kind: 'exact_lexeme',
          field: 'text',
          lang: rowLang,
          value: lexeme.text,
          score: 100,
          normalized_value: textValue,
        });
      } else if (lemmaValue === search) {
        pushMatch(exactMatches, {
          concept_id: conceptId,
          concept_level: normalizeLevel(concept.level_override ?? concept.level_auto),
          concept_pos: normalizeLang(concept.pos),
          match_kind: 'exact_lexeme',
          field: 'lemma',
          lang: rowLang,
          value: lexeme.lemma ?? lexeme.text,
          score: 95,
          normalized_value: lemmaValue,
        });
      } else if (
        isCloseSearchMatch(textValue, search) ||
        isCloseSearchMatch(lemmaValue, search)
      ) {
        pushMatch(closeMatches, {
          concept_id: conceptId,
          concept_level: normalizeLevel(concept.level_override ?? concept.level_auto),
          concept_pos: normalizeLang(concept.pos),
          match_kind: 'close_lexeme',
          field: textValue.includes(search) || search.includes(textValue) ? 'text' : 'lemma',
          lang: rowLang,
          value: lexeme.text,
          score: 60,
          normalized_value: textValue,
        });
      }
    }

    for (const form of forms) {
      const rowLang = normalizeLang(form.lang);
      if (langFilter && rowLang !== langFilter) continue;
      const surfaceValue = normalizeSearchValue(form.surface);
      if (surfaceValue === search) {
        pushMatch(exactMatches, {
          concept_id: conceptId,
          concept_level: normalizeLevel(concept.level_override ?? concept.level_auto),
          concept_pos: normalizeLang(concept.pos),
          match_kind: 'exact_form',
          field: 'surface',
          lang: rowLang,
          value: form.surface,
          score: 90,
          normalized_value: surfaceValue,
        });
      } else if (
        normalizeLang(form.form_role) === 'core' &&
        isCloseSearchMatch(surfaceValue, search)
      ) {
        pushMatch(closeMatches, {
          concept_id: conceptId,
          concept_level: normalizeLevel(concept.level_override ?? concept.level_auto),
          concept_pos: normalizeLang(concept.pos),
          match_kind: 'close_form',
          field: 'surface',
          lang: rowLang,
          value: form.surface,
          score: 55,
          normalized_value: surfaceValue,
        });
      }
    }

    for (const definition of definitions) {
      const rowLang = normalizeLang(definition.lang);
      if (langFilter && rowLang !== langFilter) continue;

      const supportFields = [
        ...(Array.isArray(definition.synonyms_json) ? definition.synonyms_json : []).map(
          (value) => ({ field: 'synonym', value }),
        ),
        ...(Array.isArray(definition.antonyms_json) ? definition.antonyms_json : []).map(
          (value) => ({ field: 'antonym', value }),
        ),
      ];

      for (const supportField of supportFields) {
        const supportValue = normalizeSearchValue(supportField.value);
        if (!supportValue) continue;
        if (supportValue === search) {
          pushMatch(supportMatches, {
            concept_id: conceptId,
            concept_level: normalizeLevel(concept.level_override ?? concept.level_auto),
            concept_pos: normalizeLang(concept.pos),
            match_kind: 'support_exact',
            field: supportField.field,
            lang: rowLang,
            value: supportField.value,
            score: 70,
            normalized_value: supportValue,
          });
        }
      }
    }
  }

  exactMatches.sort(compareMatches);
  supportMatches.sort(compareMatches);
  closeMatches.sort(compareMatches);

  const conceptMatchMap = new Map();
  for (const match of [...exactMatches, ...supportMatches, ...closeMatches]) {
    const bucket = conceptMatchMap.get(match.concept_id) ?? [];
    bucket.push(match);
    conceptMatchMap.set(match.concept_id, bucket);
  }

  const conceptSummaries = [...conceptMatchMap.entries()]
    .map(([conceptId, matches]) =>
      summarizeConcept({
        concept: index.conceptById.get(conceptId),
        languages,
        lexemes: index.lexemesByConcept.get(conceptId) ?? [],
        definitions: index.definitionsByConcept.get(conceptId) ?? [],
        examples: index.examplesByConcept.get(conceptId) ?? [],
        forms: index.formsByConcept.get(conceptId) ?? [],
        matches,
      }),
    )
    .sort((left, right) => {
      const leftBest = Math.max(...left.matches.map((row) => row.match_kind === 'exact_lexeme' || row.match_kind === 'exact_form' ? 3 : row.match_kind === 'support_exact' ? 2 : 1));
      const rightBest = Math.max(...right.matches.map((row) => row.match_kind === 'exact_lexeme' || row.match_kind === 'exact_form' ? 3 : row.match_kind === 'support_exact' ? 2 : 1));
      if (leftBest !== rightBest) {
        return rightBest - leftBest;
      }
      return left.concept_id.localeCompare(right.concept_id);
    });

  const exactConceptIds = new Set(exactMatches.map((row) => row.concept_id));
  const supportConceptIds = new Set(supportMatches.map((row) => row.concept_id));
  const closeConceptIds = new Set(closeMatches.map((row) => row.concept_id));

  return {
    input: {
      term: normalizedTerm,
      normalized_search: search,
      lang: langFilter || 'all',
    },
    overall_recommendation: buildOverallRecommendation(
      exactConceptIds,
      supportConceptIds,
      closeConceptIds,
    ),
    exact_match_count: exactMatches.length,
    support_match_count: supportMatches.length,
    close_match_count: closeMatches.length,
    concepts: conceptSummaries.slice(
      0,
      Math.max(partialLimit, conceptSummaries.filter((row) =>
        row.matches.some((match) => match.match_kind === 'exact_lexeme' || match.match_kind === 'exact_form'),
      ).length),
    ),
  };
}
