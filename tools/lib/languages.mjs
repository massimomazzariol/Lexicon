// Single source of truth for the languages Lexicon authors.
//
// A CONCEPT is language-neutral (one meaning). Each ACTIVE language gets its own
// lexeme, definition and example hung off that concept. The core is language-neutral
// on purpose, so adding a language is config here, not a rewrite.
//
// To add a language (e.g. Chinese):
//   1. add its code to LANGS and its English name to LANG_NAMES below;
//   2. for rich morphology (declension / conjugation) add a build plugin in
//      tools/lib/language_plugins/. Without a plugin the language still works -
//      its inflected forms just are not auto-generated.
//
// Codes are ISO 639-1 (lowercase). Order is the display/authoring order.

export const LANGS = ['de', 'it', 'en'];

export const LANG_NAMES = {
  de: 'German', it: 'Italian', en: 'English',
  // ready to switch on - add the code to LANGS above to activate
  fr: 'French', es: 'Spanish', pt: 'Portuguese', nl: 'Dutch',
  pl: 'Polish', ru: 'Russian', uk: 'Ukrainian',
  zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ar: 'Arabic', tr: 'Turkish'
};

/** English name for a language code (falls back to the upper-cased code). */
export const langName = (code) => LANG_NAMES[code] || String(code).toUpperCase();

/** Human list of the active languages, e.g. "German, Italian, English". */
export const langList = (langs = LANGS) => langs.map(langName).join(', ');
