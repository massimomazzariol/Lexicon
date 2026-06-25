function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeLang(value) {
  return normalizeText(value).toLowerCase();
}

const DEFINITE_ARTICLE_PREFIXES_BY_LANG = Object.freeze({
  de: Object.freeze(['der ', 'die ', 'das ', 'dem ', 'den ', 'des ']),
  en: Object.freeze(['the ']),
  it: Object.freeze(["l'", "lâ€™", 'il ', 'lo ', 'la ', 'i ', 'gli ', 'le ']),
  fr: Object.freeze(["l'", "lâ€™", 'le ', 'la ', 'les ']),
  es: Object.freeze(['el ', 'la ', 'los ', 'las ']),
});

const INDEFINITE_ARTICLE_PREFIXES_BY_LANG = Object.freeze({
  de: Object.freeze(['ein ', 'eine ', 'einen ', 'einem ', 'einer ', 'eines ']),
  en: Object.freeze(['an ', 'a ']),
  it: Object.freeze(['un ', 'uno ', 'una ', "un'", "unâ€™"]),
  fr: Object.freeze(['un ', 'une ', 'des ']),
  es: Object.freeze(['un ', 'una ', 'unos ', 'unas ']),
});

const LEADING_ARTICLE_PREFIXES_BY_LANG = Object.freeze({
  de: Object.freeze([
    ...DEFINITE_ARTICLE_PREFIXES_BY_LANG.de,
    ...INDEFINITE_ARTICLE_PREFIXES_BY_LANG.de,
  ]),
  en: Object.freeze([
    ...DEFINITE_ARTICLE_PREFIXES_BY_LANG.en,
    ...INDEFINITE_ARTICLE_PREFIXES_BY_LANG.en,
  ]),
  it: Object.freeze([
    "dell'",
    "all'",
    "nell'",
    "sull'",
    "coll'",
    ...DEFINITE_ARTICLE_PREFIXES_BY_LANG.it,
    ...INDEFINITE_ARTICLE_PREFIXES_BY_LANG.it,
    'gli ',
    'del ',
    'della ',
    'dello ',
    'dei ',
    'degli ',
    'delle ',
  ]),
  fr: Object.freeze([
    ...DEFINITE_ARTICLE_PREFIXES_BY_LANG.fr,
    ...INDEFINITE_ARTICLE_PREFIXES_BY_LANG.fr,
  ]),
  es: Object.freeze([
    ...DEFINITE_ARTICLE_PREFIXES_BY_LANG.es,
    ...INDEFINITE_ARTICLE_PREFIXES_BY_LANG.es,
  ]),
});

const LEADING_ARTICLE_TOKENS = Object.freeze([
  'der', 'die', 'das', 'den', 'dem', 'des',
  'ein', 'eine', 'einen', 'einem', 'eines',
  'la', 'il', 'lo', 'i', 'gli', 'le', 'l', 'un', 'uno', 'una',
  'the', 'a', 'an',
]);

const DEFAULT_NEUTRAL_DEFINITION_BY_LANG = Object.freeze({
  de: 'Alltagssprache in einem neutralen Kontext.',
  en: 'Everyday use in a neutral context.',
  it: 'Uso quotidiano in un contesto neutro.',
});

const DEFAULT_SAFE_EXAMPLE_BY_LANG = Object.freeze({
  de: Object.freeze({
    default: 'Eine Person reagiert in einer alltaeglichen Situation.',
    noun: 'Mehrere Personen sprechen in Ruhe ueber dieselbe Sache.',
    verb: 'Eine Person handelt in dieser Situation ganz bewusst.',
    adj: 'In dieser Situation wirkt alles deutlich in dieser Art.',
    adv: 'In dieser Situation geschieht es genau auf diese Weise.',
    chunk: 'In dieser Situation sagt eine Person genau das.',
  }),
  en: Object.freeze({
    default: 'A person reacts in an everyday situation.',
    noun: 'Several people calmly talk about the same thing.',
    verb: 'A person acts quite deliberately in this situation.',
    adj: 'In this situation, everything seems clearly that way.',
    adv: 'In this situation, it happens exactly that way.',
    chunk: 'In this situation, a person says exactly that.',
  }),
  it: Object.freeze({
    default: 'Una persona reagisce in una situazione quotidiana.',
    noun: 'Piu persone parlano con calma della stessa cosa.',
    verb: 'Una persona agisce in questa situazione in modo consapevole.',
    adj: 'In questa situazione, tutto appare chiaramente cosi.',
    adv: 'In questa situazione, accade proprio in questo modo.',
    chunk: 'In questa situazione, una persona dice proprio questo.',
  }),
});

function getPrefixes(prefixMap, lang) {
  return prefixMap[normalizeLang(lang)] ?? [];
}

export function inferSurfaceDefiniteness(surface, lang) {
  const normalized = normalizeText(surface).toLowerCase();
  if (!normalized) return 'none';

  const startsWithAny = (prefixes) =>
    prefixes.some((prefix) => normalized.startsWith(prefix));

  if (startsWithAny(getPrefixes(DEFINITE_ARTICLE_PREFIXES_BY_LANG, lang))) {
    return 'def';
  }

  if (startsWithAny(getPrefixes(INDEFINITE_ARTICLE_PREFIXES_BY_LANG, lang))) {
    return 'indef';
  }

  return 'bare';
}

export function stripLeadingArticle(text, lang) {
  const normalized = normalizeText(text);
  if (!normalized) return normalized;

  const lower = normalized.toLowerCase();
  for (const prefix of getPrefixes(LEADING_ARTICLE_PREFIXES_BY_LANG, lang)) {
    if (lower.startsWith(prefix)) {
      return normalized.slice(prefix.length).trim();
    }
  }

  return normalized;
}

export function getLeadingArticleTokens() {
  return [...LEADING_ARTICLE_TOKENS];
}

export function getDefaultNeutralDefinition(lang) {
  return (
    DEFAULT_NEUTRAL_DEFINITION_BY_LANG[normalizeLang(lang)] ??
    DEFAULT_NEUTRAL_DEFINITION_BY_LANG.en
  );
}

export function getDefaultSafeExample(lang, pos = '') {
  const defaults =
    DEFAULT_SAFE_EXAMPLE_BY_LANG[normalizeLang(lang)] ??
    DEFAULT_SAFE_EXAMPLE_BY_LANG.en;
  const normalizedPos = normalizeText(pos).toLowerCase();
  return defaults[normalizedPos] ?? defaults.default;
}

export function getDefaultSafeExampleCandidates(lang) {
  const defaults =
    DEFAULT_SAFE_EXAMPLE_BY_LANG[normalizeLang(lang)] ??
    DEFAULT_SAFE_EXAMPLE_BY_LANG.en;
  return [...new Set(Object.values(defaults).map((value) => normalizeText(value)).filter(Boolean))];
}
