// Auto-promote CLEAN AI content; hold the risky for a human - VBR-160 / EPIC-ED-01.
//
// The gate before publishing: every AI record is `review_status: needs_review`.
// This re-validates each one against the machine guardrails (spoiler, cross-language
// leak, presence, sane length, looks-like-language) and flips ONLY the clean ones to
// `reviewed`. Anything that fails a check stays `needs_review` and is listed with the
// reason, so a human reviews just the risky minority. The git diff is the final human
// glance ("auto-promote clean, review the git diff"). Preview by default; --apply
// writes content.json; never commits.
//
//   node tools/scripts/review_autopromote.mjs                 # preview what would promote/hold
//   node tools/scripts/review_autopromote.mjs --apply         # flip clean → reviewed
//   node tools/scripts/review_autopromote.mjs --file <path> [--apply]
//
// Conservative by design: when in doubt it HOLDS (better a human looks than ship wrong).

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { normalizeSearch, stripArticle, hasSpoiler, asString } from '../lib/authoring_core.mjs';
import { LANGS } from '../lib/languages.mjs';
import { loadVerbOverrides, buildSeparableByConcept, exampleDisclosesSeparable } from '../lib/language_plugins/de/verb_spoiler.mjs';

const NEEDS = 'needs_review';
const REVIEWED = 'reviewed';
const args = parseArgs(process.argv.slice(2));
const CONTENT = args.file ? resolve(process.cwd(), args.file) : resolve(process.cwd(), 'packs/lexicon_source/content.json');

main();

function main() {
  const data = JSON.parse(readFileSync(CONTENT, 'utf8'));
  const cidOf = (x) => (x && typeof x === 'object' ? x.id : x);
  const lexBy = group(data.lexemes || [], (l) => l.concept_id);
  const surfaces = (cid) =>
    Object.fromEntries(
      LANGS.map((l) => [
        l,
        (lexBy.get(cid) || []).filter((x) => x.lang === l).flatMap((x) => [stripArticle(normalizeSearch(x.text)), normalizeSearch(x.lemma)]).filter(Boolean)
      ])
    );
  const otherSurf = (s, l) => LANGS.filter((x) => x !== l).flatMap((x) => s[x] || []);
  const sepByConcept = buildSeparableByConcept(data, loadVerbOverrides(process.cwd())); // German separable-verb leak guard

  // Three confidence tiers, no git-diff step:
  //   ✅ auto  - clean AND confidence 'high' (eval_fix: several models offered + judge vetted) → reviewed → ships
  //   👀 review - clean but not high (single-model / uncorroborated) → stays needs_review → console review queue
  //   ✋ manual - failed a machine guardrail → stays needs_review → you fix by hand
  const manual = []; // { kind, lang, cid, reason }
  const manualConcepts = new Set();
  let auto = 0, review = 0;
  const tierOf = (rec, reasons) => (reasons.length ? 'manual' : rec.confidence === 'high' ? 'auto' : 'review');

  for (const d of data.concept_definitions || []) {
    if (d.review_status !== NEEDS) continue;
    const cid = cidOf(d.concept_id);
    const s = surfaces(cid);
    const reasons = defReasons(d, s[d.lang] || [], otherSurf(s, d.lang));
    const t = tierOf(d, reasons);
    if (t === 'auto') { d.review_status = REVIEWED; auto++; }
    else if (t === 'review') review++;
    else { manual.push({ kind: 'def', lang: d.lang, cid, reason: reasons.join('; ') }); manualConcepts.add(cid); }
  }
  for (const e of data.examples || []) {
    if (e.review_status !== NEEDS) continue;
    const cid = cidOf(e.concept_id);
    const s = surfaces(cid);
    const reasons = exampleReasons(e, otherSurf(s, e.lang));
    if (e.lang === 'de' && exampleDisclosesSeparable(e.sentence, sepByConcept.get(cid))) reasons.push('example uses the separable verb (would disclose the answer)');
    const t = tierOf(e, reasons);
    if (t === 'auto') { e.review_status = REVIEWED; auto++; }
    else if (t === 'review') review++;
    else { manual.push({ kind: 'ex', lang: e.lang, cid, reason: reasons.join('; ') }); manualConcepts.add(cid); }
  }
  // Lexemes are surface forms (low risk): clean → auto regardless of confidence.
  for (const lx of data.lexemes || []) {
    if (lx.review_status !== NEEDS) continue;
    const reasons = lexemeReasons(lx);
    if (reasons.length) { manual.push({ kind: 'lex', lang: lx.lang, cid: lx.concept_id, reason: reasons.join('; ') }); manualConcepts.add(lx.concept_id); }
    else { lx.review_status = REVIEWED; auto++; }
  }
  // A concept ships unless it has a ✋ manual (broken) child; medium children just wait individually.
  for (const c of data.concepts || []) {
    if (c.review_status !== NEEDS) continue;
    if (manualConcepts.has(c.concept_id)) continue;
    c.review_status = REVIEWED; auto++;
  }

  console.log('Confidence triage:');
  console.log(`  ✅ auto-published (high)     ${auto}`);
  console.log(`  👀 review queue (medium)     ${review}   → \`pnpm run lexicon\` → ‘Review queue’`);
  console.log(`  ✋ needs your hands (failed) ${manual.length}`);
  if (manual.length) {
    console.log('\nNeeds your hands:');
    for (const h of manual.slice(0, 40)) console.log(`  [${h.kind}.${h.lang}] ${h.cid}: ${h.reason}`);
    if (manual.length > 40) console.log(`  ... and ${manual.length - 40} more.`);
  }

  if (!args.apply) { console.log('\nPreview only. Re-run with --apply to commit the triage.'); return; }
  if (auto === 0 && review === 0 && manual.length === 0) { console.log('Nothing in needs_review.'); return; }
  writeFileSync(CONTENT, JSON.stringify(data, null, 2) + '\n');
  console.log(`\nDone. ✅ ${auto} ship on next build · 👀 ${review} wait in the review queue · ✋ ${manual.length} need you.`);
}

/** A definition is clean if its text (if any) is spoiler-free, sane, language-like,
 *  and its German synonyms/antonyms don't leak another language. Empty is allowed
 *  (empty beats wrong); an empty def simply ships nothing. */
function defReasons(d, ownSurf, otherSurf) {
  const reasons = [];
  const def = asString(d.short_definition).trim();
  if (def) {
    if (hasSpoiler(def, ownSurf, otherSurf)) reasons.push('definition names the word or its translation');
    if (def.length < 3) reasons.push('definition too short');
    if (def.length > 240) reasons.push('definition suspiciously long');
    if (!languageLike(def)) reasons.push('definition has odd characters / looks like gibberish');
  }
  const otherSet = new Set(otherSurf);
  for (const w of [...(d.synonyms_json || []), ...(d.antonyms_json || [])]) {
    const t = String(w ?? '').trim();
    if (!t) continue;
    if (otherSet.has(stripArticle(normalizeSearch(t)))) { reasons.push(`syn/ant "${t}" is in the wrong language`); break; }
    if (!languageLike(t)) { reasons.push(`syn/ant "${t}" looks like gibberish`); break; }
  }
  return reasons;
}
function exampleReasons(e, otherSurf) {
  const reasons = [];
  const s = asString(e.sentence).trim();
  if (!s) return ['example empty'];
  if (hasSpoiler(s, [], otherSurf)) reasons.push('example leaks the translation');
  if (s.length < 4) reasons.push('example too short');
  if (!languageLike(s)) reasons.push('example looks like gibberish');
  return reasons;
}
function lexemeReasons(lx) {
  const reasons = [];
  if (!asString(lx.text).trim()) reasons.push('lexeme text empty');
  if (!asString(lx.lemma).trim()) reasons.push('lexeme lemma empty');
  return reasons;
}

/** "Is this real language, not model garbage" heuristic. Catches the obvious mash
 *  (vowel-less long tokens like "xqzptklmnbvcxz", symbol noise like "@@@", digit
 *  soup); it canNOT catch plausible-but-wrong meaning - only the judge / the human
 *  git-diff glance does. Permissive on real words (German compounds keep their vowels). */
function languageLike(text) {
  const compact = text.replace(/\s/g, '');
  if (!compact) return false;
  const letters = (text.match(/\p{L}/gu) || []).length;
  if (letters / compact.length < 0.7) return false; // too many digits/symbols to be a phrase
  for (const tok of text.split(/\s+/)) {
    const word = tok.replace(/[^\p{L}]/gu, '');
    // a longish token with NO vowel at all is keyboard mash, not a word
    if (word.length >= 6 && !/[aeiouyàáäâãèéëêìíïîòóöôõùúüûœæø]/iu.test(word)) return false;
  }
  // runs of 2+ symbols that aren't normal punctuation (e.g. "@@@", "###", "%%")
  if (/[^\p{L}\p{N}\s.,;:!?'"’«»...\-()%/]{2,}/u.test(text)) return false;
  return true;
}

function group(a, f) { const m = new Map(); for (const x of a) { const k = f(x); (m.get(k) ?? m.set(k, []).get(k)).push(x); } return m; }
function parseArgs(argv) {
  const o = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') o.apply = true;
    else if (argv[i] === '--file') o.file = argv[++i];
  }
  return o;
}
