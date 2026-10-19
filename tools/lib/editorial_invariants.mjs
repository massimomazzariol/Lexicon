import {
  inferSurfaceDefiniteness,
  stripLeadingArticle,
} from './language_text_conventions.mjs';

const ARTICLEFUL_NOUN_LANGS = new Set(['it']);

// Text a learner reads must never carry repository ids ("siehe Konzept
// ec6fe4e3", "concept-a1-..."): consumers show these fields as they are.
const LEARNER_FACING_DEFINITION_FIELDS = [
  'short_definition',
  'usage_note',
  'hint_text',
  'sense_indicator',
];
const INTERNAL_ID_PATTERN =
  /\b(?:concept|lex|lexeme|example)-[a-z0-9]|\b[0-9a-f]{8}-[0-9a-f]{4}\b|\b(?:Konzept|concetto|concept) [0-9a-f]{6,}\b/i;

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeLang(value) {
  return normalizeText(value).toLowerCase();
}

function normalizePos(value) {
  return normalizeLang(value) || 'chunk';
}

function parseStringList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeText(entry)).filter(Boolean);
  }
  const normalized = normalizeText(value);
  return normalized ? [normalized] : [];
}

export function languageRequiresArticlefulNounSurfaces(lang) {
  return ARTICLEFUL_NOUN_LANGS.has(normalizeLang(lang));
}

export function isArticleDropDuplicate({
  canonicalSurface,
  candidate,
  lang,
}) {
  const normalizedCanonical = normalizeText(canonicalSurface);
  const normalizedCandidate = normalizeText(candidate);
  if (!normalizedCanonical || !normalizedCandidate) {
    return false;
  }

  if (inferSurfaceDefiniteness(normalizedCandidate, lang) !== 'bare') {
    return false;
  }

  const strippedCanonical = normalizeText(
    stripLeadingArticle(normalizedCanonical, lang),
  );
  if (!strippedCanonical) {
    return false;
  }

  if (strippedCanonical.toLowerCase() === normalizedCanonical.toLowerCase()) {
    return false;
  }

  return normalizedCandidate.toLowerCase() === strippedCanonical.toLowerCase();
}

export function findArticleDropDuplicates({
  canonicalSurface,
  candidates,
  lang,
}) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .filter((value) =>
      isArticleDropDuplicate({
        canonicalSurface,
        candidate: value,
        lang,
      }),
    );
}

function stripEnglishInfinitiveMarker(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return '';
  }
  return normalized.toLowerCase().startsWith('to ')
    ? normalized.slice(3).trim()
    : '';
}

export function isInfinitiveMarkerDropDuplicate({
  canonicalSurface,
  candidate,
  lang,
  pos,
}) {
  if (normalizeLang(lang) !== 'en' || normalizePos(pos) !== 'verb') {
    return false;
  }

  const normalizedCandidate = normalizeText(candidate);
  const strippedCanonical = stripEnglishInfinitiveMarker(canonicalSurface);
  if (!normalizedCandidate || !strippedCanonical) {
    return false;
  }

  return normalizedCandidate.toLowerCase() === strippedCanonical.toLowerCase();
}

export function findFormattingOnlyDuplicates({
  canonicalSurface,
  candidates,
  lang,
  pos,
}) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .filter((value) => {
      if (
        isArticleDropDuplicate({
          canonicalSurface,
          candidate: value,
          lang,
        })
      ) {
        return true;
      }
      return isInfinitiveMarkerDropDuplicate({
        canonicalSurface,
        candidate: value,
        lang,
        pos,
      });
    });
}

export function formatEditorialInvariantViolation(violation) {
  const field = normalizeText(violation?.field) || 'unknown_field';
  const lang = normalizeLang(violation?.lang) || 'unknown_lang';
  const conceptId = normalizeText(violation?.concept_id) || 'unknown_concept';
  const lexemeId = normalizeText(violation?.lexeme_id) || null;
  const slotKey = normalizeText(violation?.slot_key) || null;
  const value = normalizeText(violation?.value) || '';
  const details = [conceptId, lexemeId, lang, slotKey].filter(Boolean).join(' | ');
  return `${field} | ${details} | ${value}`;
}

export function collectEditorialInvariantViolations({
  content,
  lexemeOverridesById = new Map(),
}) {
  const concepts = Array.isArray(content?.concepts) ? content.concepts : [];
  const lexemes = Array.isArray(content?.lexemes) ? content.lexemes : [];
  const lexemeForms = Array.isArray(content?.lexeme_forms)
    ? content.lexeme_forms
    : [];
  const conceptDefinitions = Array.isArray(content?.concept_definitions)
    ? content.concept_definitions
    : [];

  const conceptPosById = new Map(
    concepts
      .map((concept) => [
        normalizeText(concept?.concept_id),
        normalizePos(concept?.pos),
      ])
      .filter(([conceptId]) => conceptId),
  );
  const nounLexemeById = new Map();
  const nounLexemeTextsByConceptLang = new Map();
  const canonicalLexemeTextsByConceptLang = new Map();
  const violations = [];

  for (const lexeme of lexemes) {
    const lexemeId = normalizeText(lexeme?.lexeme_id);
    const conceptId = normalizeText(lexeme?.concept_id);
    const lang = normalizeLang(lexeme?.lang);
    const pos = normalizePos(lexeme?.pos ?? conceptPosById.get(conceptId));
    const text = normalizeText(lexeme?.text);

    if (!lexemeId || !conceptId || !lang) {
      continue;
    }

    const canonicalConceptLangKey = `${conceptId}|${lang}`;
    const canonicalTextBucket =
      canonicalLexemeTextsByConceptLang.get(canonicalConceptLangKey) ?? [];
    if (text) {
      canonicalTextBucket.push(text);
      canonicalLexemeTextsByConceptLang.set(
        canonicalConceptLangKey,
        canonicalTextBucket,
      );
    }

    if (pos !== 'noun') {
      continue;
    }

    if (!languageRequiresArticlefulNounSurfaces(lang)) {
      continue;
    }

    nounLexemeById.set(lexemeId, {
      lexeme_id: lexemeId,
      concept_id: conceptId,
      lang,
      text,
    });

    const conceptLangKey = `${conceptId}|${lang}`;
    const textBucket = nounLexemeTextsByConceptLang.get(conceptLangKey) ?? [];
    if (text) {
      textBucket.push(text);
      nounLexemeTextsByConceptLang.set(conceptLangKey, textBucket);
    }

    if (inferSurfaceDefiniteness(text, lang) === 'bare') {
      violations.push({
        kind: 'noun_lexeme_missing_article',
        field: 'lexemes.text',
        concept_id: conceptId,
        lexeme_id: lexemeId,
        lang,
        value: text,
      });
    }
  }

  for (const form of lexemeForms) {
    const lexemeId = normalizeText(form?.lexeme_id);
    const nounLexeme = nounLexemeById.get(lexemeId);
    if (!nounLexeme) {
      continue;
    }

    const surface = normalizeText(form?.surface);
    if (inferSurfaceDefiniteness(surface, nounLexeme.lang) === 'bare') {
      violations.push({
        kind: 'noun_form_missing_article',
        field: 'lexeme_forms.surface',
        concept_id: nounLexeme.concept_id,
        lexeme_id: lexemeId,
        lang: nounLexeme.lang,
        value: surface,
      });
    }
  }

  for (const definition of conceptDefinitions) {
    const conceptId = normalizeText(definition?.concept_id);
    const lang = normalizeLang(definition?.lang);
    const pos = conceptPosById.get(conceptId);
    if (!conceptId || !lang) {
      continue;
    }
    for (const field of LEARNER_FACING_DEFINITION_FIELDS) {
      const value = normalizeText(definition?.[field]);
      if (value && INTERNAL_ID_PATTERN.test(value)) {
        violations.push({
          kind: 'internal_id_in_learner_text',
          field: `concept_definitions.${field}`,
          concept_id: conceptId,
          lexeme_id: null,
          lang,
          value,
        });
      }
    }
    if (!pos) {
      continue;
    }

    const conceptLangKey = `${conceptId}|${lang}`;
    const canonicalTexts =
      canonicalLexemeTextsByConceptLang.get(conceptLangKey) ?? [];
    if (canonicalTexts.length === 0) {
      continue;
    }

    for (const synonym of parseStringList(definition?.synonyms_json)) {
      const matchedCanonical = canonicalTexts.find((canonical) =>
        findFormattingOnlyDuplicates({
          canonicalSurface: canonical,
          candidates: [synonym],
          lang,
          pos,
        }).length > 0,
      );
      if (!matchedCanonical) {
        continue;
      }

      violations.push({
        kind:
          pos === 'noun'
            ? 'noun_support_formatting_duplicate'
            : 'support_formatting_duplicate',
        field: 'concept_definitions.synonyms_json',
        concept_id: conceptId,
        lexeme_id: null,
        lang,
        value: synonym,
        canonical_value: matchedCanonical,
      });
    }
  }

  for (const example of Array.isArray(content?.examples) ? content.examples : []) {
    const sentence = normalizeText(example?.sentence);
    if (sentence && INTERNAL_ID_PATTERN.test(sentence)) {
      violations.push({
        kind: 'internal_id_in_learner_text',
        field: 'examples.sentence',
        concept_id: normalizeText(example?.concept_id),
        lexeme_id: null,
        lang: normalizeLang(example?.lang),
        value: sentence,
      });
    }
  }

  const overrideEntries =
    lexemeOverridesById instanceof Map
      ? lexemeOverridesById.entries()
      : Object.entries(lexemeOverridesById ?? {});
  for (const [lexemeIdRaw, override] of overrideEntries) {
    const lexemeId = normalizeText(lexemeIdRaw);
    const nounLexeme = nounLexemeById.get(lexemeId);
    if (!nounLexeme || !override || typeof override !== 'object') {
      continue;
    }

    const forms =
      override.forms && typeof override.forms === 'object' ? override.forms : {};
    for (const slotKey of ['sg_core', 'pl_core']) {
      const surface = normalizeText(forms[slotKey]);
      if (!surface) {
        continue;
      }
      if (inferSurfaceDefiniteness(surface, nounLexeme.lang) !== 'bare') {
        continue;
      }
      violations.push({
        kind: 'noun_override_missing_article',
        field: `lexeme_morphology_overrides.forms.${slotKey}`,
        concept_id: nounLexeme.concept_id,
        lexeme_id: lexemeId,
        lang: nounLexeme.lang,
        slot_key: slotKey,
        value: surface,
      });
    }
  }

  return violations;
}
