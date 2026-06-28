// Per-language text conventions (articles, gender, leading-article forms, and the
// neutral default content), loaded from each language's own data file. The DATA lives in
// <lang>/conventions.json so every language owns its rules in one place; this aggregator
// exposes it to the generic text utilities (authoring_core, language_text_conventions).
// Add a language by dropping a <lang>/conventions.json and listing it in BY_LANG below.

import de from './de/conventions.json' with { type: 'json' };
import it from './it/conventions.json' with { type: 'json' };
import en from './en/conventions.json' with { type: 'json' };
import fr from './fr/conventions.json' with { type: 'json' };
import es from './es/conventions.json' with { type: 'json' };

// Order matters where a union or flat list is derived (ARTICLES_BY_LANG, ALL_ARTICLES,
// LEADING_ARTICLE_TOKENS): keep de, it, en first so the derived output is stable.
const BY_LANG = { de, it, en, fr, es };

const pick = (field) =>
  Object.fromEntries(
    Object.entries(BY_LANG)
      .filter(([, c]) => c[field] !== undefined)
      .map(([lang, c]) => [lang, c[field]]),
  );

export const ARTICLES_BY_LANG = pick('strip_articles');
export const ALL_ARTICLES = new Set(Object.values(ARTICLES_BY_LANG).flat());
export const DE_ARTICLE_GENDER = de.article_gender;

export const DEFINITE_ARTICLE_PREFIXES_BY_LANG = pick('definite_prefixes');
export const INDEFINITE_ARTICLE_PREFIXES_BY_LANG = pick('indefinite_prefixes');
export const LEADING_ARTICLE_PREFIXES_BY_LANG = pick('leading_prefixes');
export const DEFAULT_NEUTRAL_DEFINITION_BY_LANG = pick('default_neutral_definition');
export const DEFAULT_SAFE_EXAMPLE_BY_LANG = pick('default_safe_example');

export const LEADING_ARTICLE_TOKENS = ['de', 'it', 'en'].flatMap(
  (lang) => BY_LANG[lang].leading_tokens ?? [],
);
