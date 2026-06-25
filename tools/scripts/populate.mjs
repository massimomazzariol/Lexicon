// Autonomous population - VBR-160 / EPIC-ED-01.
//
// One command from a seed wordlist to reviewed content: pick the words for a level
// from the authoritative seed list (skipping anything already in the lexicon, exact
// match), then run the whole chain - draft → promote → refine (bandit+judge) → gate
// → (optional) build. This is the "empty DB → populate A1 with 100 words" path.
//
//   node tools/scripts/populate.mjs --lang de --level A1 --count 100            # preview the plan
//   node tools/scripts/populate.mjs --lang de --level A1 --count 100 --apply    # execute (needs local LLM)
//   node tools/scripts/populate.mjs --lang de --level A1 --apply --build         # + build runtime packs/dist
//
// Flags: --count <n> (default: all new) · --apply (execute; otherwise preview) ·
//   --build (also rebuild packs + distribution) · --no-refine (skip the eval_fix judge
//   pass; faster, lower quality) · --seed-dir <dir> · --model <name> (drafter) ·
//   --committee <n> / --models a,b (refine pass). Generation needs a local LLM -
//   run --apply on the GPU box. Never commits; review the git diff, then release.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { spawnSync } from 'child_process';
import { normalizeSearch, stripArticle } from '../lib/authoring_core.mjs';

const REPO = process.cwd();
const CONTENT = resolve(REPO, 'packs/lexicon_source/content.json');
const SCRIPTS = resolve(REPO, 'tools/scripts');
const DRAFTS = resolve(REPO, 'authoring/drafts');
const args = parseArgs(process.argv.slice(2));

main();

function main() {
  if (!args.lang || !args.level) {
    console.log('Usage: node tools/scripts/populate.mjs --lang de --level A1 --count 100 [--apply] [--build] [--no-refine] [--dry-run]');
    return;
  }
  const lang = args.lang.toLowerCase();
  const level = args.level.toUpperCase();
  const seedPath = resolve(REPO, args.seedDir ?? 'authoring/seeds', `${lang}_${level}.txt`);
  if (!existsSync(seedPath)) {
    console.log(`No seed list: ${rel(seedPath)}\nAdd it (one word per line) - see authoring/seeds/README.md for sourcing.`);
    return;
  }
  const seed = parseSeed(readFileSync(seedPath, 'utf8'));
  if (!seed.length) { console.log(`Seed list ${rel(seedPath)} is empty - add words first.`); return; }

  // Skip words already in the lexicon for this language (exact match on lemma/surface).
  const data = JSON.parse(readFileSync(CONTENT, 'utf8'));
  const existing = new Set();
  for (const lx of data.lexemes || []) {
    if (String(lx.lang).toLowerCase() !== lang) continue;
    existing.add(key(lx.text));
    existing.add(key(lx.lemma));
  }
  let already = 0;
  const fresh = [];
  for (const term of seed) {
    if (existing.has(key(term))) already++;
    else fresh.push(term);
  }
  const count = args.count ?? fresh.length;
  const todo = fresh.slice(0, count);

  console.log(`Seed ${rel(seedPath)}: ${seed.length} words · already in lexicon: ${already} (skipped) · new available: ${fresh.length}`);
  console.log(`Will add: ${todo.length}${args.count && todo.length < count ? ` (seed exhausted; asked ${count})` : ''} word(s) at ${lang.toUpperCase()} ${level}.`);
  if (todo.length === 0) { console.log('Nothing new - this level is already covered by the seed list.'); return; }
  console.log('  ' + todo.slice(0, 30).join(', ') + (todo.length > 30 ? ` ... (+${todo.length - 30})` : ''));

  const plan = [
    `draft_from_wishlist.mjs  (local LLM → drafts)`,
    `promote_drafts.mjs --apply  (drafts → content.json, needs_review)`,
    ...(args.refine ? [`eval_fix.mjs --level ${level} --apply  (bandit+judge fill, completes the level)`] : []),
    `review_autopromote.mjs --apply  (clean → reviewed, hold the risky)`,
    ...(args.build ? [`rebuild_runtime_packs.mjs --with-distribution  (build packs + dist)`] : [])
  ];

  if (args.dryRun || !args.apply) {
    console.log(`\nPlan (${args.dryRun ? 'dry-run' : 'preview - re-run with --apply to execute'}):`);
    plan.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
    console.log('\nGeneration needs a local LLM (run --apply on the GPU box). Never commits - review the git diff, then release.');
    return;
  }

  // EXECUTE the chain.
  mkdirSync(resolve(REPO, 'authoring/.cache'), { recursive: true });
  const wishlist = resolve(REPO, `authoring/.cache/populate-${lang}-${level}-${Date.now()}.jsonl`);
  writeFileSync(wishlist, todo.map((t) => JSON.stringify({ term: t, lang })).join('\n') + '\n');
  console.log(`\nWrote wishlist (${todo.length}): ${rel(wishlist)}`);

  step('draft', 'draft_from_wishlist.mjs', ['--wishlist', wishlist, ...(args.model ? ['--model', args.model] : [])]);
  const draft = latestDraft();
  if (!draft) { console.error('Drafter produced no draft file - stopping.'); process.exit(1); }
  step('promote', 'promote_drafts.mjs', ['--file', draft, '--apply']);
  if (args.refine) step('refine', 'eval_fix.mjs', ['--level', level, '--apply', ...refineArgs()]);
  step('gate', 'review_autopromote.mjs', ['--apply']);
  if (args.build) pipeline('rebuild_runtime_packs.mjs', ['--with-distribution']);

  console.log(`\nDone. Review:  git diff packs/lexicon_source/content.json   then commit${args.build ? '' : '  (then `npm run release`)'}.`);
}

function step(label, script, argv) {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(process.execPath, [resolve(SCRIPTS, script), ...argv], { stdio: 'inherit', cwd: REPO });
  if (r.status !== 0) {
    console.error(`Step "${label}" failed (exit ${r.status}). content.json may be partially updated - review the git diff.`);
    process.exit(r.status || 1);
  }
}
function pipeline(script, argv) {
  console.log('\n=== build ===');
  const r = spawnSync(process.execPath, [resolve(REPO, 'tools/pipeline', script), ...argv], { stdio: 'inherit', cwd: REPO });
  if (r.status !== 0) { console.error(`Build failed (exit ${r.status}).`); process.exit(r.status || 1); }
}
function refineArgs() {
  const a = [];
  if (args.committee) a.push('--committee', String(args.committee));
  if (args.models) a.push('--models', args.models);
  return a;
}
function latestDraft() {
  if (!existsSync(DRAFTS)) return null;
  const files = readdirSync(DRAFTS).filter((f) => f.endsWith('.jsonl')).sort();
  return files.length ? resolve(DRAFTS, files[files.length - 1]) : null;
}
function parseSeed(text) {
  const out = [];
  // split on \r?\n so CRLF checkouts don't leave a trailing \r (which would defeat the
  // #-comment strip and turn comment lines into "words").
  for (const line of text.split(/\r?\n/)) {
    const t = line.replace(/#.*$/, '').trim();
    if (t) out.push(t);
  }
  return out;
}
function key(s) { return stripArticle(normalizeSearch(s)); }
function rel(p) { return p.replace(REPO, '.'); }
function parseArgs(argv) {
  const o = { apply: false, dryRun: false, build: false, refine: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lang') o.lang = argv[++i];
    else if (a === '--level') o.level = argv[++i];
    else if (a === '--count') o.count = Number(argv[++i]);
    else if (a === '--apply') o.apply = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--build') o.build = true;
    else if (a === '--no-refine') o.refine = false;
    else if (a === '--seed-dir') o.seedDir = argv[++i];
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--committee') o.committee = Number(argv[++i]);
    else if (a === '--models') o.models = argv[++i];
  }
  return o;
}
