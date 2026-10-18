// Sense indicators (DL-014): a short label per concept and language that says
// WHICH meaning a shared word has, in the style of bilingual dictionary
// "sense indicators" (Oxford, Collins, PONS). Rules and sources:
// docs/policies/LEXICAL_RULES.md, section "Sense Indicators".

export const SENSE_INDICATOR_MAX_WORDS = 5;

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function isActiveLexeme(row) {
  return Boolean(row) && row.is_active !== false && row.status !== 'deprecated';
}

// Leading articles and the English infinitive marker are not part of the word
// a label must avoid ("la distanza" -> "distanza", "to know" -> "know").
const LEADING_FUNCTION_WORDS =
  /^(?:(?:to|the|a|an|der|die|das|den|dem|des|ein|eine|il|lo|la|i|gli|le|un|uno|una)\s+|l')/i;

// Lowercase words separated by single spaces, punctuation dropped, so a match
// is always a whole word ("leicht" is not inside "nicht").
function wordsOf(text) {
  return normalizeText(String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}']+/gu, ' '));
}

function bareWord(text) {
  return wordsOf(normalizeText(text).replace(LEADING_FUNCTION_WORDS, ''));
}

/**
 * Concepts that share an active surface form with another concept, in any
 * language: those are the ones a reader cannot tell apart by the word alone.
 */
export function collectSharedSurfaceConcepts(content) {
  const conceptsBySurface = new Map();
  for (const lexeme of content.lexemes ?? []) {
    if (!isActiveLexeme(lexeme)) continue;
    const key = `${lexeme.lang}|${normalizeText(lexeme.text)}`;
    const concepts = conceptsBySurface.get(key) ?? new Set();
    concepts.add(lexeme.concept_id);
    conceptsBySurface.set(key, concepts);
  }
  const groups = [...conceptsBySurface.entries()]
    .filter(([, concepts]) => concepts.size > 1)
    .map(([key, concepts]) => {
      const [lang, ...rest] = key.split('|');
      return { lang, surface: rest.join('|'), conceptIds: [...concepts].sort() };
    });
  const conceptIds = new Set(groups.flatMap((group) => group.conceptIds));
  return { groups, conceptIds };
}

/** Problems with a single indicator value (format only). */
export function senseIndicatorFormatProblems(value) {
  const text = String(value ?? '');
  const problems = [];
  if (text !== normalizeText(text)) problems.push('not trimmed / extra spaces');
  if (/[()[\]{};]/.test(text)) problems.push('brackets or semicolon');
  if (/concept-|[0-9a-f]{8}-[0-9a-f]{4}-/i.test(text)) problems.push('internal id');
  const words = normalizeText(text).split(' ').filter(Boolean).length;
  if (words === 0) problems.push('empty');
  if (words > SENSE_INDICATOR_MAX_WORDS) {
    problems.push(`more than ${SENSE_INDICATOR_MAX_WORDS} words`);
  }
  return problems;
}

/**
 * Every rule of DL-014 over a whole content payload. Returns a list of
 * { concept_id, lang, kind, detail } - empty when the content is clean.
 */
export function collectSenseIndicatorViolations(content) {
  const violations = [];
  const { groups, conceptIds } = collectSharedSurfaceConcepts(content);
  const definitions = new Map(
    (content.concept_definitions ?? []).map((row) => [
      `${row.concept_id}|${row.lang}`,
      row,
    ]),
  );
  const wordsByConceptLang = new Map();
  for (const lexeme of content.lexemes ?? []) {
    if (!isActiveLexeme(lexeme)) continue;
    const key = `${lexeme.concept_id}|${lexeme.lang}`;
    const words = wordsByConceptLang.get(key) ?? [];
    words.push(bareWord(lexeme.text));
    wordsByConceptLang.set(key, words);
  }

  for (const row of content.concept_definitions ?? []) {
    const value = row.sense_indicator;
    const key = `${row.concept_id}|${row.lang}`;
    if (value === undefined || value === null) {
      if (conceptIds.has(row.concept_id)) {
        violations.push({ ...ids(row), kind: 'missing', detail: 'shares a word with another concept' });
      }
      continue;
    }
    for (const problem of senseIndicatorFormatProblems(value)) {
      violations.push({ ...ids(row), kind: 'format', detail: problem });
    }
    const label = ` ${wordsOf(value)} `;
    for (const word of wordsByConceptLang.get(key) ?? []) {
      if (word && label.includes(` ${word} `)) {
        violations.push({ ...ids(row), kind: 'repeats_word', detail: word });
      }
    }
  }

  // Concepts sharing a word must read apart in every language.
  for (const group of groups) {
    for (const lang of new Set(group.conceptIds.flatMap((id) => langsOf(definitions, id)))) {
      const seen = new Map();
      for (const conceptId of group.conceptIds) {
        const label = normalizeText(definitions.get(`${conceptId}|${lang}`)?.sense_indicator).toLowerCase();
        if (!label) continue;
        if (seen.has(label)) {
          violations.push({
            concept_id: conceptId,
            lang,
            kind: 'not_distinct',
            detail: `same as ${seen.get(label)} ("${group.surface}")`,
          });
        }
        seen.set(label, conceptId);
      }
    }
  }
  return violations;
}

function ids(row) {
  return { concept_id: row.concept_id, lang: row.lang };
}

function langsOf(definitions, conceptId) {
  return [...definitions.keys()]
    .filter((key) => key.startsWith(`${conceptId}|`))
    .map((key) => key.slice(conceptId.length + 1));
}
