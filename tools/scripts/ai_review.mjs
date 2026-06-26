// AI auto-review - the safety net that lets the review queue clean itself.
//
// A judge model passes over the needs_review queue (definitions + examples) and PROMOTES
// the items it is confident are correct, clean and natural, leaving the doubtful ones in
// the queue for a human. Two gates, conservative by design:
//   1. machine guardrail first  - an empty or spoiler-leaking value is never promoted;
//   2. an LLM judge per item     - "keep" only when confident, else "hold".
// Promoted items become review_status: reviewed (so the next build ships them), stamped
// reviewed_by: "ai". Preview by default; --apply writes content.json; never commits.
//
//   node tools/scripts/ai_review.mjs                 # preview the queue + counts
//   node tools/scripts/ai_review.mjs --apply         # judge + promote the confident ones
//   node tools/scripts/ai_review.mjs --apply --judge <name>   # force a specific judge model

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { LANGS, langName, langList } from '../lib/languages.mjs';
import { chat, resolveModel, listChatModels, hasSpoiler, normalizeSearch, stripArticle, asString as str } from '../lib/authoring_core.mjs';

const CONTENT = resolve(process.cwd(), 'packs/lexicon_source/content.json');
const args = parseArgs(process.argv.slice(2));

main().catch((e) => { console.error('FATAL:', e?.message ?? e); process.exit(1); });

async function main() {
  const data = JSON.parse(readFileSync(CONTENT, 'utf8'));
  const cidOf = (x) => (x && typeof x === 'object' ? x.id : x);
  const lexBy = group(data.lexemes || [], (l) => cidOf(l.concept_id));
  const labelOf = (cid) => LANGS.map((l) => (lexBy.get(cid) || []).find((x) => x.lang === l)?.text).filter(Boolean).join(' / ') || cid;
  const surfaces = (cid) => Object.fromEntries(LANGS.map((l) => [l, (lexBy.get(cid) || []).filter((x) => x.lang === l).flatMap((x) => [stripArticle(normalizeSearch(x.text)), normalizeSearch(x.lemma)]).filter(Boolean)]));
  const otherSurf = (s, l) => LANGS.filter((x) => x !== l).flatMap((x) => s[x] || []);

  const items = [
    ...(data.concept_definitions || []).filter((d) => d.review_status === 'needs_review').map((row) => ({ kind: 'def', row })),
    ...(data.examples || []).filter((e) => e.review_status === 'needs_review').map((row) => ({ kind: 'ex', row })),
  ];
  if (!items.length) { console.log('Review queue empty - nothing to auto-review.'); return; }

  // The judge is the strongest installed model (listChatModels is size-desc) - a more
  // independent reviewer than the single model that drafted the content. Override with
  // --judge. With only one model installed the judge is the same family as the generator:
  // still a re-check, just weaker; the note below makes that visible.
  const allChat = args.dryRun ? [] : (await listChatModels()).map((m) => m.name);
  const model = args.dryRun ? null : await resolveModel(args.judge ?? args.model ?? allChat[0]);
  console.log(`AI auto-review: ${items.length} item(s) in the queue · judge: ${model ?? 'dry-run'}` +
    (!args.dryRun && allChat.length < 2 ? ' (only one model installed - same family as the generator)' : ''));

  let kept = 0, held = 0, flagged = 0;
  for (const [i, { kind, row }] of items.entries()) {
    const cid = cidOf(row.concept_id);
    const s = surfaces(cid);
    const value = kind === 'def' ? str(row.short_definition).trim() : str(row.sentence).trim();
    const own = s[row.lang] || [], other = otherSurf(s, row.lang);
    // Gate 1 - machine guardrail: empty example or a spoiler leak is never auto-promoted.
    if (kind === 'ex' && !value) { held++; continue; }
    if (value && hasSpoiler(value, kind === 'def' ? own : [], other)) { flagged++; continue; }
    if (args.dryRun) continue;
    // Gate 2 - the judge.
    const verdict = await judge({ kind, lang: row.lang, label: labelOf(cid), value, syn: row.synonyms_json, ant: row.antonyms_json }, model);
    if (verdict === 'keep') { row.review_status = 'reviewed'; row.reviewed_by = 'ai'; kept++; }
    else held++;
    if (args.delay && i < items.length - 1) await sleep(args.delay);
  }

  console.log(`✅ promoted ${kept}` + (args.dryRun ? '' : ` · 👀 held for you ${held}`) + ` · ✋ machine-flagged ${flagged}`);
  if (args.dryRun) { console.log('Dry run - no judge call, no write.'); return; }
  if (args.apply && kept) { writeFileSync(CONTENT, JSON.stringify(data, null, 2) + '\n'); console.log('Wrote content.json. Review the git diff, then Publish.'); }
  else if (!args.apply) console.log('Preview only. Re-run with --apply to promote.');
}

async function judge(it, model) {
  const extra = it.kind === 'def' && ((it.syn?.length) || (it.ant?.length))
    ? ` Listed synonyms: ${JSON.stringify(it.syn || [])}. Listed antonyms: ${JSON.stringify(it.ant || [])}.` : '';
  const res = await chat({
    system: `You are a strict multilingual (${langList()}) lexicography reviewer. Output STRICT JSON only.`,
    user: `Concept (its words across languages): ${it.label}.\n` +
      `Field under review: ${it.kind === 'def' ? 'definition' : 'example sentence'} in ${langName(it.lang)}.\n` +
      `Value: "${it.value}".${extra}\n` +
      `Is this value CORRECT for this concept, written in ${langName(it.lang)}, natural, accurate, and free of spoilers (it must NOT contain the word itself or its translation)? ` +
      `Reply JSON {"verdict":"keep"|"hold","reason":"<short>"}. Use "keep" ONLY if you are confident it is correct; use "hold" if it is wrong, unnatural, in the wrong language, or you are unsure.`
  }, model);
  return res && !res.parse_error && res.verdict === 'keep' ? 'keep' : 'hold';
}

function group(a, f) { const m = new Map(); for (const x of a) { const k = f(x); (m.get(k) ?? m.set(k, []).get(k)).push(x); } return m; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function parseArgs(argv) {
  const o = { apply: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') o.apply = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--judge') o.judge = argv[++i];
    else if (a === '--delay') o.delay = Number(argv[++i]) || 0;
  }
  return o;
}
