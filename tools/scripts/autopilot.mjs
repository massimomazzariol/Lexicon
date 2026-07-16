// autopilot - the autonomous engine behind `pnpm run lexicon`. EPIC-ED-01.
//
// Not the user entry point: reach it via the console - `pnpm run lexicon` → menu →
// "Fix / Fill (autopilot)", or headless `pnpm run lexicon -- --auto [flags]`.
// It does everything, in order, paced for the GPU, transparently:
//   1. SEED   - for each level that has a local seed list, add the new words (populate)
//   2. FIX    - rewrite spoiler definitions
//   3. FILL   - add missing synonyms, then missing examples
//   4. LINK   - turn synonyms/antonyms into real links + sense clusters (interconnect)
//   5. GATE   - auto-promote the clean, hold the risky (review_autopromote)
// Generation (steps using the local model) is the "compiler"; everything else is
// deterministic. It asks the real decisions up front, then runs unattended for as long
// as it takes. Resumable: fixed/added items drop out of the audit, so just re-run to continue.
//
//   pnpm run lexicon -- --auto --dry-run         # what it would do (no model needed)
//   pnpm run lexicon -- --auto --yes             # unattended, defaults (for the box)
//   pnpm run lexicon -- --auto --levels B2,C1,C2 --yes   # focus the empty upper levels
//
// Scope:  --lang de (seed language, default de) · --levels A1,B2 · --only spoilers,synonyms,examples
//   · --no-seed (skip adding new words) · --add-dangling (also draft referenced-but-missing words)
// Pacing: --chunk N (20) · --delay ms (800) · --cooldown sec (25, GPU rest) · --max-chunks N (200)
// Models: --committee N / --models a,b (fill) · --model name (seed/draft) · --build · --yes · --dry-run

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { spawnSync } from 'child_process';
import { createInterface } from 'readline';
import { auditContent, countByCategory } from '../lib/content_audit.mjs';
import { commitAndPush } from '../lib/content_diff.mjs';
import { flattenQueue } from '../lib/relation_queue.mjs';
import { diagnoseContent, repairContent } from '../lib/content_integrity.mjs';
import { C } from '../lib/colors.mjs';

const REPO = process.cwd();
const CONTENT = resolve(REPO, 'packs/lexicon_source/content.json');
const SCRIPTS = resolve(REPO, 'tools/scripts');
const SEED_DIR = resolve(REPO, 'authoring/seeds');
const ALL_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const args = parseArgs(process.argv.slice(2));
const CATS = [
  { key: 'spoilers', flag: '--spoilers', label: 'spoiler definitions' },
  { key: 'synonyms', flag: '--missing-synonyms', label: 'missing synonyms' },
  { key: 'examples', flag: '--missing-examples', label: 'missing examples' }
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

main().catch((e) => { console.error('FATAL:', e?.message ?? e); process.exit(1); });

async function main() {
  if (args.push) args.build = true; // push the freshly-built packs so the other machine gets them consistent
  const only = args.only ? new Set(args.only) : null;
  const cats = CATS.filter((c) => !only || only.has(c.key));
  const levels = args.levels ?? null;
  const chunk = args.chunk ?? 20;
  const seedLang = args.lang ?? 'de';
  const seedLevels = (levels ?? ALL_LEVELS).map((L) => ({ L, file: resolve(SEED_DIR, `${seedLang}_${L}.txt`) }));
  const withSeed = args.noSeed ? [] : seedLevels.filter((s) => existsSync(s.file));
  const noSeed = args.noSeed ? [] : seedLevels.filter((s) => !existsSync(s.file));

  // 1. audit + plan
  const audit = auditContent(read());
  const counts = countByCategory(audit, levels);
  console.log(`Lexicon autopilot - ${audit.totals.concepts} concepts${levels ? ` · levels ${levels.join(',')}` : ''}`);
  console.log(`  per level: ${ALL_LEVELS.map((l) => `${l}:${audit.perLevel[l] || 0}`).join('  ')}`);

  console.log('\nPlan:');
  if (!args.noSeed) {
    console.log(`  SEED (${seedLang}): ${withSeed.length ? withSeed.map((s) => s.L).join(', ') + ' (seed list found → add new words)' : 'none'}`);
    if (noSeed.length) console.log(`        no seed list for: ${noSeed.map((s) => s.L).join(', ')}  → drop authoring/seeds/${seedLang}_<LEVEL>.txt to populate them`);
  }
  let totalChunks = 0;
  for (const c of cats) { const n = counts[c.key]; const ch = Math.ceil(n / chunk); totalChunks += ch; console.log(`  ${c.label.padEnd(20)} ${String(n).padStart(4)} now → ~${ch} chunk(s) of ${chunk}`); }
  console.log(`  then LINK (interconnect) → GATE (auto-promote)${args.addDangling ? ' → add dangling' : ''}${args.noAiReview ? '' : ' → AI-review'}${args.build ? ' → build' : ''}${args.push ? ' → git push' : ''}`);
  if (args.publishEach) console.log('  📦 PUBLISH after every chunk - the app sees new fields as they are generated');
  if (args.push && args.publishEach) console.log('  ⬆ git push after EACH chunk - detailed commit per batch; serving machine gets it live via ' + C.yellow('pnpm run refresh'));
  else if (args.push) console.log('  ⬆ git push at the end - detailed commit (what was created); serving machine gets it with ' + C.yellow('pnpm run refresh'));
  console.log(`\n~${totalChunks} fix-chunk(s) + ${withSeed.length} seed level(s) · pacing ${chunk}/chunk, ${args.delay ?? 800}ms/item, ${args.cooldown ?? 25}s cooldown. (Seeding adds more to fill afterwards.)`);

  if (args.dryRun) { console.log('\nDry run - plan only, nothing executed.'); return; }

  // 1b. heal content-integrity problems before anything ships (dup concepts,
  // unscored, formless words). Forms are minted by regenerateForms() after SEED.
  healContent();

  // 2. ask the real decisions up front, then run unattended
  let addDangling = args.addDangling;
  if (!args.yes && process.stdin.isTTY) {
    if ((await ask('\nProceed with the autonomous run? [y/N] ')) !== 'y') { console.log('Aborted.'); return; }
    if (!addDangling) addDangling = (await ask('At the end, also draft the referenced-but-missing words? [y/N] ')) === 'y';
  } else { console.log('\nRunning unattended.'); }

  // 3. SEED - add new words for every level that has a seed list (refine happens in FILL)
  for (const s of withSeed) {
    console.log('\n' + C.b(C.cyan(`━━ ADD NEW WORDS · ${seedLang.toUpperCase()} ${s.L} ━━`)));
    run('populate.mjs', ['--lang', seedLang, '--level', s.L, '--apply', '--no-refine', ...(args.model ? ['--model', args.model] : [])]);
    await cooldown();
  }

  // New lexemes (seeded just now, or added by an earlier run/console) arrive without source
  // forms; build_target only clones forms, it never generates them. Regenerate now so every
  // lexeme has its forms before any build. Idempotent + id-preserving (keys on
  // lexeme+lang+slot), so existing form ids - and learner progress - are untouched. Fixes RH-18.
  regenerateForms();

  // 4. FIX + FILL - paced chunks until cleared or stuck
  for (const c of cats) {
    let prev = countByCategory(auditContent(read()), levels)[c.key];
    let round = 0;
    while (prev > 0 && round < (args.maxChunks ?? 200)) {
      round++;
      console.log('\n' + C.b(C.cyan(`━━ ${c.label.toUpperCase()} `)) + C.dim(`${prev} left · chunk ${round}`));
      run('eval_fix.mjs', [c.flag, ...(levels && levels.length === 1 ? ['--level', levels[0]] : []), '--limit', String(chunk), '--apply', ...(args.delay ? ['--delay', String(args.delay)] : []), ...evalExtra()]);
      await cooldown();
      const cur = countByCategory(auditContent(read()), levels)[c.key];
      if (cur >= prev) { console.log(C.yellow(`  no further progress on ${c.label} (${cur} remain - needs a human or better sources). Moving on.`)); break; }
      prev = cur;
      if (args.publishEach) publishStep(`${c.label} chunk ${round}`); // stream the ✅ tier to the app as we go
    }
  }

  // 5. LINK + GATE (final pass)
  run('interconnect.mjs', ['--apply']);
  run('review_autopromote.mjs', ['--apply']);

  // 6. optional: add referenced-but-missing words, then re-link
  if (addDangling) {
    const wish = resolve(REPO, `authoring/.cache/dangling-${Date.now()}.jsonl`);
    run('interconnect.mjs', ['--dangling-out', wish]);
    run('draft_from_wishlist.mjs', ['--wishlist', wish, ...(args.model ? ['--model', args.model] : [])]);
    run('promote_drafts.mjs', ['--apply']);
    regenerateForms(); // the freshly-promoted words need their forms before we build
    run('review_autopromote.mjs', ['--apply']);
    run('interconnect.mjs', ['--apply']);
  }
  // 6b. AI auto-review: a judge promotes the medium-confidence queue it is confident about
  // and leaves the doubtful for a human - the self-cleaning gate (opt out with --no-ai-review).
  if (!args.noAiReview) run('ai_review.mjs', ['--apply', ...(args.delay ? ['--delay', String(args.delay)] : [])]);
  if (args.build || args.publishEach) pipeline('rebuild_runtime_packs.mjs', ['--with-distribution']);
  if (args.push) gitPush();

  // 6c. refresh the human-review artifacts so the new links surface
  // immediately in the console (UI-04g): the link queue, the dangling
  // (referenced-but-missing) wishlist, and the multi-word phrase list.
  run('interconnect.mjs', ['--queue-out', 'authoring/relation_queue.json',
    '--dangling-out', 'authoring/.cache/dangling.jsonl', '--phrases-out', 'authoring/.cache/phrases.jsonl']);

  // 7. summary
  const after = countByCategory(auditContent(read()), levels);
  const lv = auditContent(read()).perLevel;
  const num = (n) => (n === 0 ? C.green('0') : C.yellow(String(n)));
  console.log('\n' + C.b(C.green('━━ DONE ━━')));
  console.log('  ' + C.dim('per level now:  ') + ALL_LEVELS.map((l) => `${C.gray(l)} ${C.b(String(lv[l] || 0))}`).join('   '));
  console.log('  ' + C.dim('still needs work:  ') + `definitions ${num(after.spoilers)}   synonyms ${num(after.synonyms)}   examples ${num(after.examples)}`);
  try {
    const q = JSON.parse(readFileSync(resolve(REPO, 'authoring/relation_queue.json'), 'utf8'));
    const depth = flattenQueue(q).length;
    console.log('  ' + C.dim('word links waiting for a human:  ') + (depth ? C.yellow(String(depth)) : C.green('0')) + C.dim('  (console -> Review word links)'));
  } catch { /* queue file missing: the interconnect step above already showed why */ }
  console.log(args.build
    ? 'Built + published the ✅ high-confidence tier. 👀 review queue + ✋ manual remain (' + C.yellow('pnpm run lexicon') + ' → Review queue).'
    : 'Triage above: ✅ ship on build · 👀 review queue · ✋ you.  Build/publish: ' + C.yellow('pnpm run release') + ' or ' + C.yellow('pnpm run lexicon') + ' → Publish.');
}

function read() { return JSON.parse(readFileSync(CONTENT, 'utf8')); }
// Heal duplicate / unscored content before a run so it never ships a pack the app
// rejects. Forms are minted by regenerateForms() after SEED. Same checks as the
// console's entry self-check and `pnpm run doctor`.
function healContent() {
  const content = read();
  const issues = diagnoseContent(content);
  if (!issues.length) return;
  console.log('\n' + C.yellow('Healing content: ') + issues.map((i) => `${i.label} ×${i.count}`).join(', '));
  const { fixes } = repairContent(content);
  if (fixes.length) {
    writeFileSync(CONTENT, JSON.stringify(content, null, 2) + '\n');
    for (const f of fixes) console.log('  ' + C.green('✓ ') + f);
  }
}
function evalExtra() { const a = []; if (args.committee) a.push('--committee', String(args.committee)); if (args.models) a.push('--models', args.models); return a; }
async function cooldown() { const s = args.cooldown ?? 25; if (s > 0) { console.log(C.dim(`  ...resting the GPU ${s}s...`)); await sleep(s * 1000); } }
function run(script, argv) {
  const r = spawnSync(process.execPath, [resolve(SCRIPTS, script), ...argv], { stdio: 'inherit', cwd: REPO });
  if (r.status !== 0) { console.error(`\nStep ${script} failed (exit ${r.status}). content.json may be partial - review the git diff. Re-run to resume.`); process.exit(r.status || 1); }
}
function pipeline(script, argv) {
  const r = spawnSync(process.execPath, [resolve(REPO, 'tools/pipeline', script), ...argv], { stdio: 'inherit', cwd: REPO });
  if (r.status !== 0) { console.error(`Build failed (exit ${r.status}).`); process.exit(r.status || 1); }
}
// Source forms = lexeme + language + grammatical slot, minted deterministically and reused by
// id when the slot already exists. Re-running is safe: it only adds forms for lexemes that lack
// them, never rewrites a live id (verified: 0 rewrites on the current pack). Keeps the editorial
// pipeline drift-free so a casual run never churns ids (RH-18).
function regenerateForms() {
  console.log(C.dim('  ...syncing source forms so new lexemes have their forms (RH-18)...'));
  pipeline('generate_pack_forms.mjs', []);
}
// Stream results to the app mid-run: link → triage → build, so the ✅ tier of each chunk
// reaches the runtime packs (and the app) immediately, instead of only at the end.
function publishStep(tag) {
  console.log(`\n📦 publish (${tag}) → link · triage · build...`);
  run('interconnect.mjs', ['--apply']);
  run('review_autopromote.mjs', ['--apply']);
  pipeline('rebuild_runtime_packs.mjs', ['--with-distribution']);
  // With --push, stream each chunk across machines too: a per-chunk commit (detailed message)
  // so the serving machine's `pnpm run refresh` picks up the new words live, not only at the end.
  if (args.push) commitAndPush(REPO, { tag: `${tag} · live`, push: true });
}
function ask(q) { return new Promise((res) => { const rl = createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); res(String(a).trim().toLowerCase()); }); }); }
// Generation machine → push the new content (content.json + runtime packs; dist is gitignored
// and rebuilt on the serving machine). The commit message spells out exactly what this batch
// created (new words, enrichment, model); skips cleanly if nothing changed. See content_diff.mjs.
function gitPush() {
  console.log('\n=== git push ===');
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const scope = (args.levels?.length ? `levels ${args.levels.join(',')}` : 'all levels') + (args.noSeed ? ', fill-only' : '');
  commitAndPush(REPO, { tag: `${ts} · autopilot (${scope})`, push: true });
}
function parseArgs(argv) {
  const o = { yes: false, dryRun: false, addDangling: false, build: false, noSeed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes' || a === '-y') o.yes = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--no-seed') o.noSeed = true;
    else if (a === '--add-dangling') o.addDangling = true;
    else if (a === '--build') o.build = true;
    else if (a === '--publish-each') o.publishEach = true;
    else if (a === '--push') o.push = true;
    else if (a === '--no-ai-review') o.noAiReview = true;
    else if (a === '--lang') o.lang = argv[++i];
    else if (a === '--only') o.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--levels') o.levels = argv[++i].split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (a === '--chunk') o.chunk = Number(argv[++i]);
    else if (a === '--delay') o.delay = Number(argv[++i]);
    else if (a === '--cooldown') o.cooldown = Number(argv[++i]);
    else if (a === '--max-chunks') o.maxChunks = Number(argv[++i]);
    else if (a === '--committee') o.committee = Number(argv[++i]);
    else if (a === '--models') o.models = argv[++i];
    else if (a === '--model') o.model = argv[++i];
  }
  return o;
}
