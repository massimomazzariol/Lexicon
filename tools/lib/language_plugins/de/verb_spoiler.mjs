// German separable-verb spoiler detection for example sentences.
//
// A separable verb is split and distant in a real sentence ("Ich stehe früh auf"
// for "aufstehen"), so a plain surface match misses it. Using the verb's
// decomposition (prefix + stem) and its conjugation, we detect disclosure even
// when the prefix and the stem form are far apart. Used by the example gate
// (review_autopromote) and the AI auto-review (ai_review).

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { analyzeGermanVerb, conjugateGermanVerb } from './verb_build_plugin.mjs';

const tokenize = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-zà-ÿ ]+/gi, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Load the curated morphology overrides as a Map keyed by lexeme_id. */
export function loadVerbOverrides(repoRoot = process.cwd()) {
  try {
    const raw = JSON.parse(readFileSync(resolve(repoRoot, 'packs/lexicon_source/lexeme_morphology_overrides.json'), 'utf8'));
    return raw.lexeme_overrides ?? {};
  } catch {
    return {};
  }
}

/**
 * Build the spoiler descriptor for a German separable verb, or null if it is not
 * separable. `override` is its entry from lexeme_morphology_overrides.json (may be undefined).
 */
export function separableSpoilerForms(lemma, override) {
  const lc = String(lemma ?? '').toLowerCase().trim();
  if (!lc) return null;
  const analysis = override?.verb_class ? override : (analyzeGermanVerb(lc, {}) ?? {});
  if (analysis.verb_class !== 'separable') return null;
  const prefix = String(override?.prefix ?? analysis.prefix ?? '').toLowerCase();
  const stem = String(override?.stem ?? analysis.stem ?? '').toLowerCase();
  if (!prefix || !stem) return null;

  const conj = conjugateGermanVerb(lc, { override });
  const f = conj?.forms ?? {};
  // Forms that appear as ONE contiguous token (the infinitive, partizip II, zu-infinitive).
  const contiguous = new Set([lc, f.partizip_ii, f.zu_inf].map((v) => String(v ?? '').toLowerCase()).filter(Boolean));
  // The stem part of the split forms (drop the trailing " <prefix>" the conjugator appends).
  const stripPrefix = (v) => String(v ?? '').toLowerCase().replace(new RegExp(`\\s+${prefix}$`), '').trim();
  const explicit = new Set([f.praes_2sg, f.praes_3sg, f.praet_3sg].map(stripPrefix).filter(Boolean));
  // Stem roots for prefix-matching the present persons not in the slot set: the weak root
  // (ich stehe, wir stehen) PLUS the strong present root (gibt -> gib, fährt -> fähr) so
  // strong 2sg/3sg/imperative (gib, nimm, fähr...) are caught too.
  const roots = new Set([stem.replace(/e?n$/, ''), stripPrefix(f.praes_3sg).replace(/et$|t$/, '')].filter((r) => r.length >= 3));
  return { prefix, roots: [...roots], explicit, contiguous };
}

/**
 * Map concept_id -> separable-spoiler descriptor for every German separable-verb lexeme
 * in [content]. [overrides] is loadVerbOverrides(). Concepts with no German separable verb
 * are absent from the map.
 */
export function buildSeparableByConcept(content, overrides) {
  const cidOf = (x) => (x && typeof x === 'object' ? (x.id ?? String(x)) : String(x));
  const map = new Map();
  for (const l of content.lexemes ?? []) {
    if (l.is_active === false || String(l.lang).toLowerCase() !== 'de' || l.pos !== 'verb') continue;
    const sep = separableSpoilerForms(l.lemma || l.text, overrides[l.lexeme_id]);
    if (sep) map.set(cidOf(l.concept_id), sep);
  }
  return map;
}

/** True when [example] discloses the separable verb described by [sep]. */
export function exampleDisclosesSeparable(example, sep) {
  if (!sep) return false;
  const tk = tokenize(example);
  if (tk.some((t) => sep.contiguous.has(t))) return true; // a contiguous form is present
  if (!tk.includes(sep.prefix)) return false;             // no prefix -> the split verb is not used
  return tk.some((t) => sep.explicit.has(t) || sep.roots.some((r) => t.startsWith(r)));
}
