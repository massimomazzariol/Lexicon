// Generic, language-agnostic text conventions: definiteness inference, leading-article
// stripping, and neutral default content. The per-language DATA (article forms, default
// definitions/examples) is NOT here - it lives in each language's
// language_plugins/<lang>/conventions.json and is aggregated by language_plugins/conventions.mjs.
// This module holds only the logic that consumes that data.

import {
  DEFINITE_ARTICLE_PREFIXES_BY_LANG,
  INDEFINITE_ARTICLE_PREFIXES_BY_LANG,
  LEADING_ARTICLE_PREFIXES_BY_LANG,
  LEADING_ARTICLE_TOKENS,
  DEFAULT_NEUTRAL_DEFINITION_BY_LANG,
  DEFAULT_SAFE_EXAMPLE_BY_LANG,
} from './language_plugins/conventions.mjs';

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeLang(value) {
  return normalizeText(value).toLowerCase();
}

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
