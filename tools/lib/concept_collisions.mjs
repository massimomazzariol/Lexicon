import {
  DEFAULT_LEXICON_LEVEL,
  normalizeLexiconLevel,
} from './lexicon_conventions.mjs';

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

function buildConceptIndex(content) {
  const concepts = Array.isArray(content.concepts) ? content.concepts : [];
  const lexemes = Array.isArray(content.lexemes) ? content.lexemes : [];
  const forms = Array.isArray(content.lexeme_forms) ? content.lexeme_forms : [];

  const conceptById = new Map(concepts.map((concept) => [concept.concept_id, concept]));
  const lexemeById = new Map();
  const lexemesByConcept = new Map();
  const formsByConcept = new Map();

  for (const lexeme of lexemes) {
    lexemeById.set(lexeme.lexeme_id, lexeme);
    if (!isActiveLexeme(lexeme)) continue;
    const bucket = lexemesByConcept.get(lexeme.concept_id) ?? [];
    bucket.push(lexeme);
    lexemesByConcept.set(lexeme.concept_id, bucket);
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
    formsByConcept,
  };
}

function buildConceptLabels(languages, lexemesByConcept) {
  const labelsByConcept = new Map();
  for (const [conceptId, lexemes] of lexemesByConcept.entries()) {
    const labels = {};
    for (const lang of languages) {
      const rows = lexemes
        .filter((row) => normalizeLang(row.lang) === lang)
        .sort(compareLexemes);
      if (rows.length > 0) {
        labels[lang] = rows.find((row) => row.is_primary)?.text ?? rows[0]?.text ?? null;
      }
    }
    labelsByConcept.set(conceptId, labels);
  }
  return labelsByConcept;
}

function ensureGroup(map, key, payloadFactory) {
  if (!map.has(key)) {
    map.set(key, payloadFactory());
  }
  return map.get(key);
}

function addGroupSignal(group, signal) {
  const dedupeKey = [
    signal.concept_id,
    signal.signal_kind,
    signal.lang,
    signal.normalized_value,
    signal.is_primary ? 'primary' : 'secondary',
  ].join('|');
  if (group.signal_keys.has(dedupeKey)) {
    return;
  }
  group.signal_keys.add(dedupeKey);
  group.signals.push(signal);
  group.concept_ids.add(signal.concept_id);
  group.signal_kinds.add(signal.signal_kind);
  if (signal.is_primary) {
    group.primary_concept_ids.add(signal.concept_id);
  }
}

function buildCollisionGroups(index) {
  const groups = new Map();

  for (const [conceptId, lexemes] of index.lexemesByConcept.entries()) {
    for (const lexeme of lexemes) {
      const rowLang = normalizeLang(lexeme.lang);
      const textValue = normalizeSearchValue(lexeme.text);
      const lemmaValue = normalizeSearchValue(lexeme.lemma ?? lexeme.text);

      if (textValue) {
        const group = ensureGroup(
          groups,
          `${rowLang}|${textValue}`,
          () => ({
            lang: rowLang,
            normalized_value: textValue,
            display_value: lexeme.text,
            signals: [],
            signal_keys: new Set(),
            concept_ids: new Set(),
            signal_kinds: new Set(),
            primary_concept_ids: new Set(),
          }),
        );
        addGroupSignal(group, {
          concept_id: conceptId,
          lang: rowLang,
          raw_value: lexeme.text,
          normalized_value: textValue,
          signal_kind: 'lexeme_text',
          is_primary: lexeme.is_primary === true,
        });
      }

      if (lemmaValue && lemmaValue !== textValue) {
        const group = ensureGroup(
          groups,
          `${rowLang}|${lemmaValue}`,
          () => ({
            lang: rowLang,
            normalized_value: lemmaValue,
            display_value: lexeme.lemma ?? lexeme.text,
            signals: [],
            signal_keys: new Set(),
            concept_ids: new Set(),
            signal_kinds: new Set(),
            primary_concept_ids: new Set(),
          }),
        );
        addGroupSignal(group, {
          concept_id: conceptId,
          lang: rowLang,
          raw_value: lexeme.lemma ?? lexeme.text,
          normalized_value: lemmaValue,
          signal_kind: 'lexeme_lemma',
          is_primary: lexeme.is_primary === true,
        });
      }
    }
  }

  for (const [conceptId, forms] of index.formsByConcept.entries()) {
    for (const form of forms) {
      if (normalizeLang(form.form_role) !== 'core') continue;
      const rowLang = normalizeLang(form.lang);
      const surfaceValue = normalizeSearchValue(form.surface);
      if (!surfaceValue) continue;
      const group = ensureGroup(
        groups,
        `${rowLang}|${surfaceValue}`,
        () => ({
          lang: rowLang,
          normalized_value: surfaceValue,
          display_value: form.surface,
          signals: [],
          signal_keys: new Set(),
          concept_ids: new Set(),
          signal_kinds: new Set(),
          primary_concept_ids: new Set(),
        }),
      );
      addGroupSignal(group, {
        concept_id: conceptId,
        lang: rowLang,
        raw_value: form.surface,
        normalized_value: surfaceValue,
        signal_kind: 'core_form',
        is_primary: form.lexeme_is_primary === true,
      });
    }
  }

  return [...groups.values()]
    .filter((group) => group.concept_ids.size > 1)
    .map((group) => ({
      lang: group.lang,
      normalized_value: group.normalized_value,
      display_value: group.display_value,
      concept_ids: [...group.concept_ids],
      signal_kinds: [...group.signal_kinds].sort(),
      primary_concept_ids: [...group.primary_concept_ids],
      signals: group.signals,
    }));
}

function summarizeGroupRecommendation(group, concepts) {
  const posCount = new Set(concepts.map((concept) => concept.pos)).size;
  if (posCount > 1) {
    return 'review_split_for_polysemy';
  }
  const primaryCount = group.primary_concept_ids.length;
  if (primaryCount > 1) {
    return 'review_possible_duplicate_or_merge';
  }
  return 'review_split_or_disambiguation';
}

function buildGroupSummaries({ groups, index, labelsByConcept, termFilter, langFilter, conceptIdFilter }) {
  return groups
    .filter((group) => {
      if (langFilter && group.lang !== langFilter) return false;
      if (termFilter && group.normalized_value !== termFilter) return false;
      if (conceptIdFilter.size > 0 && !group.concept_ids.some((conceptId) => conceptIdFilter.has(conceptId))) {
        return false;
      }
      return true;
    })
    .map((group) => {
      const concepts = group.concept_ids
        .map((conceptId) => {
          const concept = index.conceptById.get(conceptId);
          return {
            concept_id: conceptId,
            level: normalizeLevel(concept?.level_override ?? concept?.level_auto),
            pos: normalizeLang(concept?.pos),
            labels: labelsByConcept.get(conceptId) ?? {},
          };
        })
        .sort((left, right) => left.concept_id.localeCompare(right.concept_id));
      return {
        lang: group.lang,
        normalized_value: group.normalized_value,
        display_value: group.display_value,
        concept_count: group.concept_ids.length,
        signal_kinds: group.signal_kinds,
        recommendation: summarizeGroupRecommendation(group, concepts),
        concepts,
      };
    })
    .sort((left, right) => {
      if (left.concept_count !== right.concept_count) {
        return right.concept_count - left.concept_count;
      }
      if (left.lang !== right.lang) {
        return left.lang.localeCompare(right.lang);
      }
      return left.normalized_value.localeCompare(right.normalized_value);
    });
}

function pairKey(leftConceptId, rightConceptId) {
  return [leftConceptId, rightConceptId].sort().join('|');
}

function addPairSignal(pair, group) {
  const dedupeKey = `${group.lang}|${group.normalized_value}`;
  if (pair.signal_keys.has(dedupeKey)) {
    return;
  }
  pair.signal_keys.add(dedupeKey);
  pair.shared_languages.add(group.lang);
  pair.shared_values.push({
    lang: group.lang,
    value: group.display_value,
    normalized_value: group.normalized_value,
    signal_kinds: group.signal_kinds,
  });
  if (group.primary_concept_ids.includes(pair.left_concept_id) && group.primary_concept_ids.includes(pair.right_concept_id)) {
    pair.primary_overlap_languages.add(group.lang);
  }
}

function buildPairCandidates({ groups, index, labelsByConcept, termFilter, langFilter, conceptIdFilter, minPairScore }) {
  const pairMap = new Map();

  for (const group of groups) {
    if (langFilter && group.lang !== langFilter) continue;
    if (termFilter && group.normalized_value !== termFilter) continue;
    const conceptIds = group.concept_ids
      .filter((conceptId) => conceptIdFilter.size === 0 || conceptIdFilter.has(conceptId));
    if (conceptIdFilter.size > 0 && conceptIds.length < 2) {
      continue;
    }
    for (let indexLeft = 0; indexLeft < conceptIds.length; indexLeft += 1) {
      for (let indexRight = indexLeft + 1; indexRight < conceptIds.length; indexRight += 1) {
        const leftConceptId = conceptIds[indexLeft];
        const rightConceptId = conceptIds[indexRight];
        const key = pairKey(leftConceptId, rightConceptId);
        const pair = ensureGroup(
          pairMap,
          key,
          () => ({
            left_concept_id: leftConceptId,
            right_concept_id: rightConceptId,
            signal_keys: new Set(),
            shared_languages: new Set(),
            primary_overlap_languages: new Set(),
            shared_values: [],
          }),
        );
        addPairSignal(pair, group);
      }
    }
  }

  return [...pairMap.values()]
    .map((pair) => {
      const leftConcept = index.conceptById.get(pair.left_concept_id);
      const rightConcept = index.conceptById.get(pair.right_concept_id);
      const score =
        pair.shared_values.length +
        pair.shared_languages.size +
        pair.primary_overlap_languages.size;
      const recommendation =
        pair.shared_languages.size >= 2 || pair.primary_overlap_languages.size >= 2
          ? 'review_possible_duplicate_or_merge'
          : 'review_split_or_disambiguation';
      return {
        left: {
          concept_id: pair.left_concept_id,
          level: normalizeLevel(leftConcept?.level_override ?? leftConcept?.level_auto),
          pos: normalizeLang(leftConcept?.pos),
          labels: labelsByConcept.get(pair.left_concept_id) ?? {},
        },
        right: {
          concept_id: pair.right_concept_id,
          level: normalizeLevel(rightConcept?.level_override ?? rightConcept?.level_auto),
          pos: normalizeLang(rightConcept?.pos),
          labels: labelsByConcept.get(pair.right_concept_id) ?? {},
        },
        score,
        shared_languages: [...pair.shared_languages].sort(),
        primary_overlap_languages: [...pair.primary_overlap_languages].sort(),
        shared_values: pair.shared_values.sort((left, right) => {
          if (left.lang !== right.lang) return left.lang.localeCompare(right.lang);
          return left.normalized_value.localeCompare(right.normalized_value);
        }),
        recommendation,
      };
    })
    .filter((pair) => pair.score >= minPairScore)
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return pairKey(left.left.concept_id, left.right.concept_id).localeCompare(
        pairKey(right.left.concept_id, right.right.concept_id),
      );
    });
}

export function buildConceptCollisionReport({
  manifest,
  content,
  lang = '',
  term = '',
  conceptIds = [],
  limit = 20,
  minPairScore = 2,
}) {
  const index = buildConceptIndex(content);
  const languages = collectLanguages(manifest, content);
  const labelsByConcept = buildConceptLabels(languages, index.lexemesByConcept);
  const groups = buildCollisionGroups(index);
  const langFilter = normalizeLang(lang);
  const termFilter = normalizeOptional(term)
    ? normalizeSearchValue(term)
    : '';
  const conceptIdFilter = new Set(
    conceptIds
      .flatMap((value) => String(value ?? '').split(','))
      .map((value) => normalizeOptional(value))
      .filter(Boolean),
  );

  const overloadedTerms = buildGroupSummaries({
    groups,
    index,
    labelsByConcept,
    termFilter,
    langFilter,
    conceptIdFilter,
  });
  const pairCandidates = buildPairCandidates({
    groups,
    index,
    labelsByConcept,
    termFilter,
    langFilter,
    conceptIdFilter,
    minPairScore,
  });

  const missingRequestedConceptIds = [...conceptIdFilter].filter(
    (conceptId) => !index.conceptById.has(conceptId),
  );

  return {
    filters: {
      lang: langFilter || null,
      term: termFilter || null,
      concept_ids: [...conceptIdFilter],
      missing_requested_concept_ids: missingRequestedConceptIds,
      limit: Math.max(1, limit),
      min_pair_score: Math.max(1, minPairScore),
    },
    totals: {
      overloaded_term_groups: overloadedTerms.length,
      pair_candidates: pairCandidates.length,
    },
    overloaded_terms: overloadedTerms.slice(0, Math.max(1, limit)),
    pair_candidates: pairCandidates.slice(0, Math.max(1, limit)),
  };
}
