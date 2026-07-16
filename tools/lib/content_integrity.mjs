// Source-content integrity: detect (and safely repair) the data problems that
// otherwise reach a pack and break a consumer - duplicate primary keys, unscored
// concepts, and words with no forms (not studyable).
//
// These all came from one place: the AI-draft promotion path adds rows without
// the invariants `upsert` enforces. Rather than chase each symptom downstream,
// the console + autopilot run `diagnoseContent` on entry and `repairContent`
// to heal, so bad data never ships. Form minting is delegated to
// `generate_pack_forms` (flagged via `needsFormGen`) since that is its job.

import { defaultDifficultyForLevel } from './lexicon_conventions.mjs';
import { diagnoseRelations, repairRelationOrphans } from './concept_relations.mjs';

function isMeaningful(value) {
  return (
    value !== null &&
    value !== undefined &&
    value !== '' &&
    !(Array.isArray(value) && value.length === 0)
  );
}

function meaningfulFieldCount(row) {
  return Object.values(row).filter(isMeaningful).length;
}

function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows ?? []) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function activeLexemes(content) {
  return (content.lexemes ?? []).filter((lexeme) => lexeme.is_active !== false);
}

function formCountByLexeme(content) {
  const counts = new Map();
  for (const form of content.lexeme_forms ?? []) {
    counts.set(form.lexeme_id, (counts.get(form.lexeme_id) ?? 0) + 1);
  }
  return counts;
}

// A concept is studyable only if its PRIMARY lexeme has forms (the card is built
// from the primary). A secondary/synonym lexeme without forms is fine - it is an
// alternative answer, not the studyable card - and the noun generator
// intentionally skips genderless secondaries, so we don't flag those.
function lexemesMissingForms(content) {
  const counts = formCountByLexeme(content);
  return activeLexemes(content).filter(
    (lexeme) => lexeme.is_primary === true && !(counts.get(lexeme.lexeme_id) > 0),
  );
}

// --- Language hygiene -------------------------------------------------------
// Two problems are detectable without a model: (1) German words copied into the
// IT/EN synonym/antonym lists by the old German-only generation (e.g. gehen's
// Italian opposites listing "kommen, stehen"), and (2) "examples" that merely
// repeat the definition verbatim. Both are deterministic to find and strip.

function normToken(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// The German "surface" of each concept: its German lexemes plus the German
// synonyms/antonyms. Leakage is when one of those exact German strings reappears
// in the SAME concept's IT/EN list - a wholesale copy of the German side. Scoping
// to the same concept avoids false-flagging real IT/EN words that merely happen
// to also be German (cognates like the English "halt").
function germanSurfacesByConcept(content) {
  const byConcept = new Map();
  const add = (conceptId, value) => {
    const n = normToken(value);
    if (!n) return;
    if (!byConcept.has(conceptId)) byConcept.set(conceptId, new Set());
    byConcept.get(conceptId).add(n);
  };
  for (const lexeme of content.lexemes ?? []) {
    if (lexeme.lang !== 'de') continue;
    add(lexeme.concept_id, lexeme.text);
    add(lexeme.concept_id, lexeme.lemma);
  }
  for (const def of content.concept_definitions ?? []) {
    if (def.lang !== 'de') continue;
    for (const token of def.synonyms_json ?? []) add(def.concept_id, token);
    for (const token of def.antonyms_json ?? []) add(def.concept_id, token);
  }
  return byConcept;
}

function isGermanLeak(token, conceptId, lang, byConcept) {
  if (lang === 'de') return false;
  const set = byConcept.get(conceptId);
  if (!set) return false;
  const n = normToken(token);
  return n.length > 0 && set.has(n);
}

function definitionEchoes(defText, sentence) {
  const a = normToken(defText);
  return a.length > 0 && a === normToken(sentence);
}

// Only antonyms are auto-cleaned. Synonyms are graded answers, and a German-looking
// synonym is often a valid IT/EN cognate/loanword (e.g. "monitor" for "schermo"),
// which we must not delete. Antonyms are not graded and their leaks are unambiguous
// wholesale copies of the German side (e.g. "Mann"/"der Mann" in an Italian list).
const LEAK_FIELDS = ['antonyms_json'];

function diagnoseHygiene(content) {
  const byConcept = germanSurfacesByConcept(content);
  const leak = [];
  for (const def of content.concept_definitions ?? []) {
    if (def.lang === 'de') continue;
    for (const field of LEAK_FIELDS) {
      for (const token of def[field] ?? []) {
        if (isGermanLeak(token, def.concept_id, def.lang, byConcept)) {
          leak.push(`${def.concept_id}|${def.lang}|${field.replace('_json', '')}: ${token}`);
        }
      }
    }
  }
  const defByKey = new Map();
  for (const def of content.concept_definitions ?? []) {
    defByKey.set(`${def.concept_id}|${def.lang}`, def.short_definition);
  }
  const echo = [];
  for (const ex of content.examples ?? []) {
    if (definitionEchoes(defByKey.get(`${ex.concept_id}|${ex.lang}`), ex.sentence)) {
      echo.push(`${ex.concept_id}|${ex.lang}`);
    }
  }
  return { byConcept, leak, echo };
}

// --- Translation collisions -------------------------------------------------
// Two DIFFERENT concepts that share the SAME primary translation in a base
// language are ambiguous to study base→target: the learner sees one prompt
// (e.g. IT "andare a prendere") but two different target words are "correct"
// (holen AND abholen). German - the headword language - is excluded because
// homographs there are expected and legitimate (e.g. "die Bank" bench vs. bank).
//
// This is a REVIEW signal, never auto-fixable: differentiating the translation
// needs editorial/model judgement, so it is reported (doctor) and left for the
// box to regenerate - we never silently rewrite it (no silent fallback). For
// that reason it is intentionally NOT part of diagnoseContent's heal path.
export function diagnoseCollisions(content, { excludeLangs = ['de'] } = {}) {
  const exclude = new Set(excludeLangs.map((lang) => String(lang).toLowerCase()));
  const byLangText = new Map(); // `${lang}|${normText}` → { lang, text, conceptIds:Set }
  for (const lexeme of activeLexemes(content)) {
    if (lexeme.is_primary !== true) continue;
    const lang = String(lexeme.lang ?? '').toLowerCase();
    if (!lang || exclude.has(lang)) continue;
    const norm = normToken(lexeme.text);
    if (!norm) continue;
    const key = `${lang}|${norm}`;
    if (!byLangText.has(key)) {
      byLangText.set(key, { lang, text: lexeme.text, conceptIds: new Set() });
    }
    byLangText.get(key).conceptIds.add(lexeme.concept_id);
  }
  const collisions = [];
  for (const entry of byLangText.values()) {
    if (entry.conceptIds.size > 1) {
      collisions.push({
        lang: entry.lang,
        text: entry.text,
        conceptIds: [...entry.conceptIds],
      });
    }
  }
  return collisions;
}

// --- Typography normalization -----------------------------------------------
// Em/en dashes and the ellipsis character are AI-writing tells we keep out of
// the published content. Normalize them deterministically to a plain hyphen and
// three dots across every string value (definitions, examples, notes, ...), so
// regenerated content never reintroduces them.
const _typographyReplacements = [
  [/—/g, '-'], // em dash
  [/–/g, '-'], // en dash
  [/…/g, '...'], // ellipsis
];

function _hasLongDash(value) {
  return (
    typeof value === 'string' &&
    (value.includes('—') ||
      value.includes('–') ||
      value.includes('…'))
  );
}

function _scanTypography(node, acc) {
  if (typeof node === 'string') {
    if (_hasLongDash(node)) {
      acc.count += 1;
      if (acc.samples.length < 5) acc.samples.push(node.slice(0, 48));
    }
  } else if (Array.isArray(node)) {
    for (const v of node) _scanTypography(v, acc);
  } else if (node && typeof node === 'object') {
    for (const v of Object.values(node)) _scanTypography(v, acc);
  }
}

/// Mutates `content`, rewriting em/en dashes and ellipsis characters in every
/// string value. Returns the number of strings changed.
export function normalizeTypography(content) {
  let fixed = 0;
  const fixString = (s) => {
    let out = s;
    for (const [re, rep] of _typographyReplacements) out = out.replace(re, rep);
    if (out !== s) fixed += 1;
    return out;
  };
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        if (typeof node[i] === 'string') node[i] = fixString(node[i]);
        else walk(node[i]);
      }
    } else if (node && typeof node === 'object') {
      for (const key of Object.keys(node)) {
        if (typeof node[key] === 'string') node[key] = fixString(node[key]);
        else walk(node[key]);
      }
    }
  };
  walk(content);
  return fixed;
}

/// Returns a list of issues: [{ kind, label, count, samples, needsFormGen? }].
/// Empty array means the content is healthy.
export function diagnoseContent(content) {
  const issues = [];

  const dupConcepts = [...groupBy(content.concepts, (r) => r.concept_id)].filter(
    ([, group]) => group.length > 1,
  );
  if (dupConcepts.length) {
    issues.push({
      kind: 'duplicate_concept',
      label: 'duplicate concept rows',
      count: dupConcepts.length,
      samples: dupConcepts.slice(0, 5).map(([id]) => id),
    });
  }

  const dupDefs = [
    ...groupBy(content.concept_definitions, (r) => `${r.concept_id}|${r.lang}`),
  ].filter(([, group]) => group.length > 1);
  if (dupDefs.length) {
    issues.push({
      kind: 'duplicate_definition',
      label: 'duplicate definitions (concept + language)',
      count: dupDefs.length,
      samples: dupDefs.slice(0, 5).map(([key]) => key),
    });
  }

  const dupLexemes = [...groupBy(content.lexemes, (r) => r.lexeme_id)].filter(
    ([, group]) => group.length > 1,
  );
  if (dupLexemes.length) {
    issues.push({
      kind: 'duplicate_lexeme',
      label: 'duplicate lexeme ids',
      count: dupLexemes.length,
      samples: dupLexemes.slice(0, 5).map(([id]) => id),
    });
  }

  // Orphans: rows whose parent no longer exists. They can't import and usually
  // come from a half-applied edit or a deleted concept.
  const conceptIds = new Set((content.concepts ?? []).map((c) => c.concept_id));
  const lexemeIds = new Set((content.lexemes ?? []).map((l) => l.lexeme_id));
  const orphanChecks = [
    ['orphan_lexeme', 'lexemes with no concept', (content.lexemes ?? []).filter((l) => !conceptIds.has(l.concept_id)).map((l) => l.lexeme_id)],
    ['orphan_form', 'forms with no lexeme', (content.lexeme_forms ?? []).filter((f) => !lexemeIds.has(f.lexeme_id)).map((f) => f.form_id)],
    ['orphan_definition', 'definitions with no concept', (content.concept_definitions ?? []).filter((d) => !conceptIds.has(d.concept_id)).map((d) => `${d.concept_id}|${d.lang}`)],
    ['orphan_example', 'examples with no concept', (content.examples ?? []).filter((e) => !conceptIds.has(e.concept_id)).map((e) => e.example_id ?? e.concept_id)],
  ];
  for (const [kind, label, ids] of orphanChecks) {
    if (ids.length) issues.push({ kind, label, count: ids.length, samples: ids.slice(0, 5) });
  }

  const unscored = (content.concepts ?? []).filter(
    (c) => c.difficulty_score_auto === null || c.difficulty_score_auto === undefined,
  );
  if (unscored.length) {
    issues.push({
      kind: 'missing_difficulty',
      label: 'concepts with no difficulty score',
      count: unscored.length,
      samples: unscored.slice(0, 5).map((c) => c.concept_id),
    });
  }

  const missingForms = lexemesMissingForms(content);
  if (missingForms.length) {
    issues.push({
      kind: 'missing_forms',
      label: 'active words with no forms (not studyable)',
      count: missingForms.length,
      samples: missingForms.slice(0, 5).map((l) => l.lexeme_id),
      needsFormGen: true,
    });
  }

  const hygiene = diagnoseHygiene(content);
  if (hygiene.leak.length) {
    issues.push({
      kind: 'language_leak',
      label: 'German words leaking into IT/EN antonyms (opposites)',
      count: hygiene.leak.length,
      samples: hygiene.leak.slice(0, 5),
    });
  }
  if (hygiene.echo.length) {
    issues.push({
      kind: 'example_echoes_definition',
      label: 'examples that just repeat the definition',
      count: hygiene.echo.length,
      samples: hygiene.echo.slice(0, 5),
    });
  }

  // Graph invariants (MT-C5 design section 5): orphan endpoints, self-edges,
  // ordering/uniqueness, one type per pair, tier/scope/id shape, level span.
  issues.push(...diagnoseRelations(content));

  const typography = { count: 0, samples: [] };
  _scanTypography(content, typography);
  if (typography.count) {
    issues.push({
      kind: 'long_dash',
      label: 'em/en dashes or ellipsis characters in text',
      count: typography.count,
      samples: typography.samples,
    });
  }

  return issues;
}

function pickRichest(group, scoreOf) {
  return group.slice().sort((a, b) => scoreOf(b) - scoreOf(a))[0];
}

// Dedupe by key, keeping the richest row per key, preserving the first-seen order.
function dedupeKeepRichest(rows, keyOf, scoreOf) {
  const groups = groupBy(rows, keyOf);
  const best = new Map();
  let dropped = 0;
  for (const [key, group] of groups) {
    best.set(key, group.length === 1 ? group[0] : pickRichest(group, scoreOf));
    dropped += group.length - 1;
  }
  const emitted = new Set();
  const out = [];
  for (const row of rows ?? []) {
    const key = keyOf(row);
    if (emitted.has(key)) continue;
    emitted.add(key);
    out.push(best.get(key));
  }
  return { out, dropped };
}

/// Mutates `content` in place applying the safe, deterministic repairs and
/// returns { content, fixes: string[], needsFormGen: bool }. Reviewed/richest
/// rows win on dedupe. Form minting is NOT done here - when `needsFormGen` is
/// true the caller should run generate_pack_forms.
export function repairContent(content) {
  const fixes = [];

  const conceptRes = dedupeKeepRichest(
    content.concepts ?? [],
    (r) => r.concept_id,
    (r) => (r.review_status === 'reviewed' ? 1000 : 0) + meaningfulFieldCount(r),
  );
  if (conceptRes.dropped) {
    content.concepts = conceptRes.out;
    fixes.push(`deduped ${conceptRes.dropped} concept row(s)`);
  }

  const defRes = dedupeKeepRichest(
    content.concept_definitions ?? [],
    (r) => `${r.concept_id}|${r.lang}`,
    (r) =>
      (r.review_status === 'reviewed' ? 1000 : 0) +
      (typeof r.short_definition === 'string' ? r.short_definition.length : 0) +
      (Array.isArray(r.synonyms_json) ? r.synonyms_json.length * 10 : 0),
  );
  if (defRes.dropped) {
    content.concept_definitions = defRes.out;
    fixes.push(`deduped ${defRes.dropped} definition(s)`);
  }

  const lexRes = dedupeKeepRichest(
    content.lexemes ?? [],
    (r) => r.lexeme_id,
    (r) => meaningfulFieldCount(r),
  );
  if (lexRes.dropped) {
    content.lexemes = lexRes.out;
    fixes.push(`deduped ${lexRes.dropped} lexeme(s)`);
  }

  // Drop orphans (rows whose parent no longer exists) - they can't import.
  const liveConceptIds = new Set((content.concepts ?? []).map((c) => c.concept_id));
  const drop = (key, predicate, label) => {
    const before = (content[key] ?? []).length;
    content[key] = (content[key] ?? []).filter(predicate);
    const removed = before - content[key].length;
    if (removed) fixes.push(`removed ${removed} ${label}`);
  };
  drop('lexemes', (l) => liveConceptIds.has(l.concept_id), 'orphan lexeme(s)');
  const liveLexemeIds = new Set((content.lexemes ?? []).map((l) => l.lexeme_id));
  drop('lexeme_forms', (f) => liveLexemeIds.has(f.lexeme_id), 'orphan form(s)');
  drop('concept_definitions', (d) => liveConceptIds.has(d.concept_id), 'orphan definition(s)');
  drop('examples', (e) => liveConceptIds.has(e.concept_id), 'orphan example(s)');

  let scored = 0;
  for (const concept of content.concepts ?? []) {
    if (
      concept.difficulty_score_auto === null ||
      concept.difficulty_score_auto === undefined
    ) {
      concept.difficulty_score_auto = defaultDifficultyForLevel(concept.level_auto);
      scored += 1;
    }
  }
  if (scored) fixes.push(`scored ${scored} concept(s) by level`);

  // Strip German words that leaked into IT/EN antonym lists (antonyms only - see
  // LEAK_FIELDS: synonyms are graded answers and German-looking ones are often
  // valid cognates we must not delete).
  const byConcept = germanSurfacesByConcept(content);
  let leakStripped = 0;
  for (const def of content.concept_definitions ?? []) {
    if (def.lang === 'de') continue;
    for (const field of LEAK_FIELDS) {
      if (!Array.isArray(def[field]) || def[field].length === 0) continue;
      const before = def[field].length;
      def[field] = def[field].filter((token) => !isGermanLeak(token, def.concept_id, def.lang, byConcept));
      leakStripped += before - def[field].length;
    }
  }
  if (leakStripped) {
    fixes.push(`removed ${leakStripped} wrong-language token(s) from IT/EN antonyms`);
  }

  // Drop "examples" that merely repeat the definition verbatim.
  const defTextByKey = new Map();
  for (const def of content.concept_definitions ?? []) {
    defTextByKey.set(`${def.concept_id}|${def.lang}`, def.short_definition);
  }
  const beforeEx = (content.examples ?? []).length;
  content.examples = (content.examples ?? []).filter(
    (ex) => !definitionEchoes(defTextByKey.get(`${ex.concept_id}|${ex.lang}`), ex.sentence),
  );
  const echoRemoved = beforeEx - (content.examples ?? []).length;
  if (echoRemoved) {
    fixes.push(`removed ${echoRemoved} example(s) that just repeated the definition`);
  }

  const dashesNormalized = normalizeTypography(content);
  if (dashesNormalized) {
    fixes.push(
      `normalized ${dashesNormalized} string(s) with em/en dashes or ellipsis`,
    );
  }

  // Heal loop rule 5 (OVE-4): drop edges whose endpoint concept is gone -
  // same shape as the four child-table orphan drops above.
  const edgeOrphans = repairRelationOrphans(content);
  if (edgeOrphans) fixes.push(`removed ${edgeOrphans} orphan concept relation(s)`);

  const needsFormGen = lexemesMissingForms(content).length > 0;
  return { content, fixes, needsFormGen };
}
