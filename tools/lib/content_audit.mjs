// Shared, deterministic content auditor - the single source of "what's wrong" used by
// both the report (content_report) and the autonomous fixer (fix_lexicon). No model,
// no model server - pure analysis of content.json. EPIC-ED-01.

import { normalizeSearch, stripArticle, hasSpoiler } from './authoring_core.mjs';
import { LANGS } from './languages.mjs';

export const AUDIT_LANGS = LANGS;

const cidOf = (x) => (x && typeof x === 'object' ? x.id : x);
function group(a, f) { const m = new Map(); for (const x of a) { const k = f(x); (m.get(k) ?? m.set(k, []).get(k)).push(x); } return m; }

/**
 * Per-concept issue detection. Returns:
 *   perLevel: { A1: n, ... }
 *   issues:   [{ concept_id, level, spoilerLangs[], noSyn, missingExLangs[] }]  (only concepts with ≥1 issue)
 *   totals:   { concepts, missingSyn, missingEx, spoilerDefs }
 * Mirrors content_report's definitions of "spoiler / no-synonyms / no-examples".
 */
export function auditContent(data) {
  const concepts = data.concepts || [];
  const lexemes = data.lexemes || [];
  const defs = data.concept_definitions || [];
  const examples = data.examples || [];
  const lexBy = group(lexemes, (l) => l.concept_id);
  const defBy = group(defs, (d) => cidOf(d.concept_id));
  const exBy = group(examples, (e) => cidOf(e.concept_id));

  const surfaces = (cid) =>
    Object.fromEntries(
      AUDIT_LANGS.map((l) => [
        l,
        (lexBy.get(cid) || []).filter((x) => x.lang === l).flatMap((x) => [stripArticle(normalizeSearch(x.text)), normalizeSearch(x.lemma)]).filter((s) => s && s.length >= 3)
      ])
    );

  const perLevel = {};
  const issues = [];
  let missingSyn = 0, missingEx = 0, spoilerDefs = 0;

  // Phase 5: synonym support lives in the graph once a pair is decided, so a
  // synonym-type edge that covers a language counts as coverage - otherwise
  // the autopilot would regenerate the very flat strings the edges consumed.
  const synEdgeLangs = new Map(); // concept_id -> Set(lang) | null (= all langs)
  for (const e of data.concept_relations ?? []) {
    if (e.relation_type !== 'synonym') continue;
    for (const id of [e.concept_a, e.concept_b]) {
      const scope = Array.isArray(e.lang_scope_json) ? e.lang_scope_json : null;
      const cur = synEdgeLangs.get(id);
      if (cur === null) continue; // already covers every language
      if (scope === null) { synEdgeLangs.set(id, null); continue; }
      const set = cur ?? new Set();
      for (const l of scope) set.add(l);
      synEdgeLangs.set(id, set);
    }
  }
  const hasSynEdge = (cid, lang) => {
    const v = synEdgeLangs.get(cid);
    return v === null || (v instanceof Set && v.has(lang));
  };

  for (const c of concepts) {
    const level = c.level_override || c.level_auto || '?';
    perLevel[level] = (perLevel[level] || 0) + 1;
    const cdefs = defBy.get(c.concept_id) || [];
    const s = surfaces(c.concept_id);
    const spoilerLangs = cdefs
      .filter((d) => hasSpoiler(d.short_definition, s[d.lang] || [], AUDIT_LANGS.filter((x) => x !== d.lang).flatMap((x) => s[x] || [])))
      .map((d) => d.lang);
    // Per language: a concept needs synonym work if a language that has a real
    // definition still has no synonyms. (Was "no synonyms in ANY language", which
    // hid the missing Italian/English synonyms once German had some - so valid
    // translations like "comparare" were never added and got marked wrong.)
    const noSyn = AUDIT_LANGS.some((l) => {
      const d = cdefs.find((x) => x.lang === l);
      return d && String(d.short_definition ?? '').trim() &&
        !(d.synonyms_json || []).length && !hasSynEdge(c.concept_id, l);
    });
    const exLangs = new Set((exBy.get(c.concept_id) || []).map((e) => e.lang));
    const missingExLangs = AUDIT_LANGS.filter((l) => !exLangs.has(l));

    spoilerDefs += spoilerLangs.length;
    if (noSyn) missingSyn++;
    if (missingExLangs.length) missingEx++;
    if (spoilerLangs.length || noSyn || missingExLangs.length) {
      issues.push({ concept_id: c.concept_id, level, spoilerLangs, noSyn, missingExLangs });
    }
  }

  return { perLevel, issues, totals: { concepts: concepts.length, missingSyn, missingEx, spoilerDefs } };
}

/** Count remaining work per fixable category, optionally restricted to a set of levels. */
export function countByCategory(audit, levels = null) {
  const sel = (i) => !levels || levels.includes(i.level);
  return {
    spoilers: audit.issues.filter((i) => sel(i) && i.spoilerLangs.length).length,
    synonyms: audit.issues.filter((i) => sel(i) && i.noSyn).length,
    examples: audit.issues.filter((i) => sel(i) && i.missingExLangs.length).length
  };
}
