// Lexicon - THE single console. EPIC-ED-01.
//
// One clear menu to grow & tend the multilingual vocabulary (German/Italian/English
// today, via language plugins). Each item is THIN: it drives the
// engines we already have (draft/promote, eval_fix bandit+judge, interconnect, gate),
// plus two small AI helpers (suggest words / correct+disambiguate a word). The "Autopilot"
// item runs the autonomous engine (autopilot.mjs). The human is the gate. Generation needs
// a local LLM. Zero dependencies (readline + ANSI colors) so it runs straight after a pull.
//
//   pnpm run lexicon                       # this interactive menu
//   pnpm run lexicon -- --auto [flags]     # headless: run the autopilot, no menu (for the box)
//        e.g. pnpm run lexicon -- --auto --publish-each --push --cooldown 25 --chunk 20
//   (any autopilot flag - --yes/--push/--publish-each/--levels... - also implies --auto)
//   NO_COLOR=1 pnpm run lexicon            # disable colors

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { spawnSync } from 'child_process';
import { createInterface } from 'readline';
import { auditContent, countByCategory } from '../lib/content_audit.mjs';
import { commitAndPush } from '../lib/content_diff.mjs';
import { chat, resolveModel, normalizeSearch, stripArticle } from '../lib/authoring_core.mjs';
import { discoverConcepts } from '../lib/concept_discovery.mjs';
import { diagnoseContent, repairContent } from '../lib/content_integrity.mjs';
import { C } from '../lib/colors.mjs';
import { LANGS, langName, langList } from '../lib/languages.mjs';

const REPO = process.cwd();
const CONTENT = resolve(REPO, 'packs/lexicon_source/content.json');
const MANIFEST = resolve(REPO, 'packs/lexicon_source/manifest.json');
const SCRIPTS = resolve(REPO, 'tools/scripts');
const CACHE = resolve(REPO, 'authoring/.cache');
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

// ── the menu: [title, what it does, handler] ────────────────────────────────────
const MENU = [
  ['Add common words for a level', 'the AI suggests CEFR words - you pick which to keep', doSeed],
  ['Find a word', 'check if a word already exists - typos & similar words are caught', doFind],
  ['Browse words', 'list the words already in the lexicon - filter by level or text', doBrowse],
  ['Edit a word', 'change definitions, synonyms, antonyms, examples by hand - tracked, no AI', doEdit],
  ['Add one specific word', 'type a word (typos ok) - the AI corrects & connects it', doAdd],
  ['Grow from gaps', 'add words other entries point to but that are still missing', doExpand],
  ['Autopilot - fill what is missing', 'runs on its own: fills, publishes & pushes live, chunk by chunk', doFix],
  ['Review AI suggestions', 'approve or reject the items waiting for a human', doReview],
  ['Status report', 'see what is done and what still needs work', doStatus],
  ['Publish', 'build the packs + push to GitHub so the app updates', doPublish],
  ['Quit', '', null]
];

// Headless detection: --auto, or any autopilot flag, runs the engine without the menu.
const RAW = process.argv.slice(2);
const AUTOPILOT_FLAGS = ['--auto', '--yes', '-y', '--publish-each', '--push', '--no-seed', '--add-dangling', '--build', '--dry-run', '--levels', '--only', '--chunk', '--delay', '--cooldown', '--lang', '--model', '--models', '--committee', '--max-chunks'];
const HEADLESS = RAW.some((a) => AUTOPILOT_FLAGS.includes(a));

async function main() {
  if (HEADLESS) return runAutopilot(RAW); // `pnpm run lexicon -- --auto ...` → engine, no menu
  if (!process.stdin.isTTY) { console.log('Run ' + C.yellow('pnpm run lexicon') + ' in a terminal for the menu, or ' + C.yellow('pnpm run lexicon -- --auto') + ' for a headless run.'); return; }
  healOnStartup(); // self-check: fix any content-integrity problems before the menu
  for (;;) {
    header();
    const choice = await mainMenu();
    const item = MENU[choice];
    if (!item) { console.log(C.dim('  (type a number from the list)')); continue; }
    if (!item[2]) { console.log(C.dim('Bye.')); return; } // Quit
    try {
      await item[2]();
    } catch (e) {
      const offline = /ECONNREFUSED|fetch failed|local LLM/i.test(String(e?.message));
      console.log('\n' + C.red('✗ ' + (e?.message ?? e)) + (offline ? C.yellow('  (is the local LLM server running?)') : ''));
    }
    await ask(C.dim('\n(press Enter to return to the menu) '));
  }
}

function header() {
  const a = auditContent(read());
  const c = countByCategory(a);
  const bar = '─'.repeat(54);
  const num = (n) => (n === 0 ? C.green('0') : C.yellow(String(n)));
  console.log('\n' + C.cyan(bar));
  console.log(' ' + C.b(C.cyan('LEXICON')) + C.dim('  ·  multilingual vocabulary builder'));
  console.log(C.cyan(bar));
  console.log(' ' + C.b(String(a.totals.concepts)) + C.dim(' words total    ') +
    LEVELS.map((l) => `${C.gray(l)} ${C.b(String(a.perLevel[l] || 0))}`).join('   '));
  console.log(' ' + C.dim('still needs work:') +
    `  definitions ${num(c.spoilers)}   synonyms ${num(c.synonyms)}   examples ${num(c.examples)}`);
}

async function mainMenu() {
  console.log('\n' + C.b('What do you want to do?'));
  MENU.forEach(([title, desc], i) => {
    console.log(`  ${C.b(C.cyan(String(i + 1)))}  ${C.b(title)}${desc ? C.dim('  - ' + desc) : ''}`);
  });
  const n = parseInt(await ask(C.cyan(`\n> pick 1-${MENU.length}: `)), 10);
  return Number.isInteger(n) && n >= 1 && n <= MENU.length ? n - 1 : -1;
}

// 1. SEED - the AI proposes words for a level; you pick; we draft+promote+link+gate.
async function doSeed() {
  console.log(C.dim('\nThe AI will suggest common words for a level; you choose which to add.'));
  const lang = await pick('Language', LANGS);
  const level = await pick('Level', LEVELS);
  const n = Number(await ask(`How many ${C.b(level)} ${langName(lang)} words to suggest? ${C.dim('[10]')} `)) || 10;
  console.log(C.dim('Asking the model...'));
  const existing = surfaceSet(lang);
  const proposed = (await proposeWords(lang, level, n)).filter((w) => !existing.has(key(w)));
  if (!proposed.length) { console.log(C.yellow('No new candidates (all already in the lexicon, or the model returned none).')); return; }
  const chosen = await askMulti(`${C.green(String(proposed.length))} new ${level} word(s) suggested - keep which?`, proposed);
  if (!chosen.length) { console.log(C.dim('Nothing selected.')); return; }
  await addWords(chosen.map((w) => ({ term: w, lang })));
}

// 2. FIND - is this word already in the lexicon? Read-only, offline, typo-tolerant.
// Exact hits = already a headword; "as synonym/antonym" = present as support; "similar"
// = a near-match (likely typo or related word). Offers to add only if nothing exact.
async function doFind() {
  console.log(C.dim('\nCheck if a word is already in the lexicon. Typos are caught - "machne" still finds "machen".'));
  const raw = await ask('Word: ');
  if (!raw) return;
  const langChoice = await pick('Language', ['all', ...LANGS]);
  const lang = langChoice === 'all' ? '' : langChoice;
  let summary;
  try {
    summary = discoverConcepts({ manifest: readManifest(), content: read(), term: raw, lang, partialLimit: 12 });
  } catch (e) { console.log(C.red('  ' + (e?.message ?? e))); return; }

  const ex = summary.exact_match_count, sup = summary.support_match_count, close = summary.close_match_count;
  console.log('');
  if (ex > 0) console.log('  ' + C.green('✓ already in the lexicon') + C.dim(`  (${ex} exact match${ex > 1 ? 'es' : ''})`));
  else if (sup > 0) console.log('  ' + C.blue('• not a headword - but it appears as a synonym/antonym of an existing word'));
  else if (close > 0) console.log('  ' + C.yellow('• not found - but there are similar words (possible typo?)'));
  else console.log('  ' + C.dim('• not found - looks like a new word'));

  for (const c of summary.concepts) {
    const kinds = new Set(c.matches.map((m) => m.match_kind));
    const tag = kinds.has('exact_lexeme') || kinds.has('exact_form') ? C.green('[exact]')
      : kinds.has('support_exact') ? C.blue('[as synonym/antonym]') : C.yellow('[similar]');
    const labels = LANGS.map((l) => (c.labels?.[l] ? `${C.gray(l)} ${C.b(c.labels[l])}` : null)).filter(Boolean).join('  ');
    console.log(`  ${tag} ${labels}  ${C.dim(`${c.level} ${c.pos}`)}`);
    // Show what was actually generated for this word, per language, so it's clear
    // what the model produced - definition, synonyms, antonyms, one example.
    for (const l of LANGS) {
      const d = c.definitions_by_lang?.[l];
      const ex = c.example_sample_by_lang?.[l]?.[0];
      const syn = d?.synonyms?.length ? d.synonyms.join(', ') : '';
      const ant = d?.antonyms?.length ? d.antonyms.join(', ') : '';
      if (!d?.short_definition && !syn && !ant && !ex) continue; // nothing generated here
      console.log('       ' + C.gray(l) + '  ' + (d?.short_definition ? C.dim('“' + d.short_definition + '”') : C.dim('(no definition)')));
      if (syn) console.log('           ' + C.cyan('also accepted: ') + C.b(syn));
      if (ant) console.log('           ' + C.dim('opposites: ' + ant));
      if (ex)  console.log('           ' + C.dim('ex: ' + ex));
    }
    const gaps = [
      c.coverage.missing_definition_langs.length ? `def ${c.coverage.missing_definition_langs.join(',')}` : null,
      c.coverage.missing_example_langs.length ? `examples ${c.coverage.missing_example_langs.join(',')}` : null,
      c.coverage.missing_lexeme_langs.length ? `lexeme ${c.coverage.missing_lexeme_langs.join(',')}` : null,
    ].filter(Boolean).join(' · ');
    if (gaps) console.log('       ' + C.dim('still missing: ' + gaps));
  }

  if (ex === 0 && await confirm('\n' + C.b('Add it') + C.dim(' - the AI will correct & connect it') + ` ${C.dim('[y/N]')} `)) {
    await addCorrectedWord(raw);
  }
}

// German nouns are stored as the bare lemma + a gender field; the definite article
// (der/die/das) is derived from the gender for display - the same mapping the build uses.
const DE_ARTICLE = { masc: 'der', m: 'der', fem: 'die', f: 'die', neut: 'das', n: 'das' };
function deCitation(text, gender, pos) {
  if (!text || /^(der|die|das)\s/i.test(text)) return text; // bare or already carries the article
  if (pos === 'noun' && gender) {
    const art = DE_ARTICLE[String(gender).toLowerCase()];
    if (art) return `${art} ${text}`;
  }
  return text; // not a noun, or no gender on record: leave it bare (no invented article)
}

// 2b. BROWSE - list the words already in the lexicon (read-only, offline). Filter by
// level and/or a text substring so you can see what is there without searching one by one.
async function doBrowse() {
  const data = read();
  const byConcept = new Map();
  for (const c of data.concepts || []) {
    byConcept.set(c.concept_id, { level: c.level_override || c.level_auto || '?', pos: c.pos || '', labels: {} });
  }
  for (const lx of data.lexemes || []) {
    if (lx.is_active === false) continue;
    const e = byConcept.get(lx.concept_id);
    if (!e) continue;
    const l = String(lx.lang).toLowerCase();
    if (LANGS.includes(l) && !e.labels[l]) e.labels[l] = l === 'de' ? deCitation(lx.text, lx.gender, e.pos) : lx.text;
  }
  let rows = [...byConcept.values()];
  const level = await pick('Level', ['all', ...LEVELS]);
  if (level !== 'all') rows = rows.filter((r) => r.level === level);
  const sortLang = await pick('Show / sort by language', LANGS);
  const order = await pick('Order', ['alphabetical', 'by level']);
  const filter = (await ask('Filter by text ' + C.dim('(optional, Enter for all)') + ': ')).toLowerCase();
  if (filter) rows = rows.filter((r) => LANGS.some((l) => (r.labels[l] || '').toLowerCase().includes(filter)));
  if (!rows.length) { console.log(C.yellow('\nNo words match.')); return; }
  const lvlIdx = (l) => { const i = LEVELS.indexOf(l); return i < 0 ? 99 : i; };
  const alpha = (r) => key(r.labels[sortLang] || r.labels.de || r.labels.en || r.labels.it || '');
  rows.sort((a, b) => order === 'by level'
    ? (lvlIdx(a.level) - lvlIdx(b.level) || alpha(a).localeCompare(alpha(b)))
    : (alpha(a).localeCompare(alpha(b)) || lvlIdx(a.level) - lvlIdx(b.level)));
  const langOrder = [sortLang, ...LANGS.filter((l) => l !== sortLang)]; // chosen language first
  console.log(`\n${C.b(String(rows.length))} word(s)${level !== 'all' ? ' at ' + C.b(level) : ''}${filter ? ` matching "${filter}"` : ''}` +
    C.dim(`  (by ${langName(sortLang)}, ${order})`) + ':');
  const PAGE = 40; // paginate so a large lexicon does not flood the terminal
  for (let i = 0; i < rows.length; i += PAGE) {
    console.log('');
    for (const r of rows.slice(i, i + PAGE)) {
      const labels = langOrder.map((l) => (r.labels[l] ? `${C.gray(l)} ${C.b(r.labels[l])}` : null)).filter(Boolean).join('  ');
      console.log(`  ${C.cyan((r.level || '?').padEnd(2))} ${C.dim((r.pos || '').padEnd(5))} ${labels}`);
    }
    if (i + PAGE < rows.length) {
      const more = await ask(C.dim(`  -- ${Math.min(i + PAGE, rows.length)}/${rows.length} shown - Enter for more, `) + C.cyan('q') + C.dim(' to stop: '));
      if (more.toLowerCase() === 'q') break;
    }
  }
}

// 2c. EDIT - hand-edit an existing word's definition / synonyms / antonyms / examples.
// Nothing is delegated to the AI. Every change is tracked (source 'human', editor = git
// user.name, timestamp, optional reason) and marked reviewed (the human is the gate).
async function doEdit() {
  const data = read();
  const raw = await ask('Word to edit: ');
  if (!raw) return;
  let summary;
  try { summary = discoverConcepts({ manifest: readManifest(), content: data, term: raw, lang: '', partialLimit: 12 }); }
  catch (e) { console.log(C.red('  ' + (e?.message ?? e))); return; }
  if (!summary.concepts.length) { console.log(C.yellow('  Not found.')); return; }
  let concept = summary.concepts[0];
  if (summary.concepts.length > 1) {
    const opts = summary.concepts.map((c) => LANGS.map((l) => c.labels?.[l]).filter(Boolean).join(' / ') + `  [${c.level} ${c.pos}]`);
    const i = await menu('Which one?', opts);
    if (i < 0) return;
    concept = summary.concepts[i];
  }
  const conceptId = concept.concept_id;
  const findDef = (lang) => data.concept_definitions.find((x) => cidOf(x.concept_id) === conceptId && x.lang === lang);
  const defFor = (lang) => {
    let d = findDef(lang);
    if (!d) { d = { concept_id: conceptId, lang, short_definition: null, usage_note: null, context_tags_json: [], synonyms_json: [], antonyms_json: [], antonym_policy_json: null, hint_text: null }; data.concept_definitions.push(d); }
    return d;
  };
  const examplesFor = (lang) => data.examples.filter((e) => cidOf(e.concept_id) === conceptId && e.lang === lang);

  const touched = new Set();
  let changed = false;
  for (;;) {
    console.log('\n' + C.cyan('-'.repeat(44)));
    console.log(' ' + C.b(LANGS.map((l) => concept.labels?.[l]).filter(Boolean).join(' / ')) + C.dim(`  [${concept.level} ${concept.pos}]`));
    for (const l of LANGS) {
      const d = findDef(l);
      const ex = examplesFor(l);
      if (!d && !ex.length) continue;
      console.log(' ' + C.gray(l) + '  ' + (d?.short_definition ? C.dim('"' + d.short_definition + '"') : C.dim('(no definition)')));
      if (d?.synonyms_json?.length) console.log('      ' + C.cyan('syn: ') + d.synonyms_json.join(', '));
      if (d?.antonyms_json?.length) console.log('      ' + C.dim('ant: ') + d.antonyms_json.join(', '));
      ex.forEach((e, i) => console.log('      ' + C.dim(`ex${i + 1}: ` + e.sentence)));
    }
    const action = await menu('Edit what?',
      ['Definition', 'Add synonym', 'Remove synonym', 'Add antonym', 'Remove antonym', 'Add example', 'Remove example', 'Save & quit', 'Quit without saving']);
    if (action === 7) break;
    if (action === 8) { console.log(C.dim('Discarded - nothing saved.')); return; }
    if (action < 0) continue;
    if (action === 0) {
      const lang = await pick('Language', LANGS);
      const cur = findDef(lang)?.short_definition || '';
      const v = await ask(`New definition (${C.gray(lang)})${cur ? C.dim(' [current: "' + cur + '"]') : ''}: `);
      if (v) { defFor(lang).short_definition = v.trim(); touched.add(defFor(lang)); changed = true; }
    } else if (action === 1 || action === 3) {
      const field = action === 1 ? 'synonyms_json' : 'antonyms_json';
      const lang = await pick('Language', LANGS);
      const w = await ask(`${action === 1 ? 'Synonym' : 'Antonym'} to ADD (${C.gray(lang)}): `);
      if (w) { const d = defFor(lang); d[field] = [...new Set([...(d[field] || []), w.trim()])]; touched.add(d); changed = true; }
    } else if (action === 2 || action === 4) {
      const field = action === 2 ? 'synonyms_json' : 'antonyms_json';
      const lang = await pick('Language', LANGS);
      const d = findDef(lang);
      if (!d?.[field]?.length) { console.log(C.dim('  none')); continue; }
      const i = await menu('Remove which', d[field]);
      if (i >= 0) { d[field].splice(i, 1); touched.add(d); changed = true; }
    } else if (action === 5) {
      const lang = await pick('Language', LANGS);
      const s = await ask(`New example sentence (${C.gray(lang)}): `);
      if (s) { const e = { example_id: `example-${lang}-${Date.now().toString(36)}`, concept_id: conceptId, lang, sentence: s.trim() }; data.examples.push(e); touched.add(e); changed = true; }
    } else if (action === 6) {
      const lang = await pick('Language', LANGS);
      const ex = examplesFor(lang);
      if (!ex.length) { console.log(C.dim('  none')); continue; }
      const i = await menu('Remove which', ex.map((e) => e.sentence));
      if (i >= 0) { const e = ex[i]; data.examples = data.examples.filter((x) => x !== e); touched.delete(e); changed = true; }
    }
  }
  if (!changed) { console.log(C.dim('No changes.')); return; }
  const reason = await ask('Reason for these edits ' + C.dim('(optional, Enter to skip)') + ': ');
  const editor = gitEditor();
  const at = new Date().toISOString();
  for (const row of touched) {
    row.source = 'human';
    row.edited_by = editor;
    row.edited_at = at;
    if (reason) row.edit_reason = reason.trim();
    row.review_status = 'reviewed';
  }
  writeFileSync(CONTENT, JSON.stringify(data, null, 2) + '\n');
  console.log(C.green(`Saved ${touched.size} change(s)`) + C.dim(` as ${editor}. To ship: `) + C.yellow('pnpm run lexicon') + C.dim(' -> Publish.'));
}

// 3. ADD - type a word (typos ok); the AI corrects + disambiguates; you confirm.
async function doAdd() {
  console.log(C.dim('\nType a word (typos are fine). The AI fixes it, finds its senses, then connects it.'));
  const raw = await ask('Word: ');
  if (!raw) return;
  await addCorrectedWord(raw);
}

// Shared by Find + Add: correct the typed word with the model, show senses, confirm, add.
async function addCorrectedWord(raw) {
  console.log(C.dim('Asking the model...'));
  const r = await correctWord(raw);
  if (!r || r.unknown) { console.log(C.yellow('The model does not recognise that as a real word.')); return; }
  const lang = LANGS.includes(r.lang) ? r.lang : await pick('Language', LANGS);
  const fixed = r.corrected?.toLowerCase() !== raw.toLowerCase();
  console.log('\n  ' + C.green('→ ') + C.b(`"${r.corrected}"`) + C.dim(`  (${lang}, ${r.pos ?? '?'})`) + (fixed ? C.yellow(`   [corrected from "${raw}"]`) : ''));
  if (Array.isArray(r.senses) && r.senses.length) r.senses.forEach((s, i) => console.log(C.dim(`     sense ${i + 1}: `) + s));
  if (surfaceSet(lang).has(key(r.corrected))) console.log(C.yellow('  ⚠ a word with this spelling already exists - adding may duplicate it.'));
  if (!(await confirm(`Add ${C.b(`"${r.corrected}"`)} and connect it? ${C.dim('[y/N]')} `))) return;
  await addWords([{ term: r.corrected, lang }]);
}

// 4. EXPAND - grow from the graph: the dangling references are the frontier.
async function doExpand() {
  console.log(C.dim('\nMany entries name synonyms/antonyms that are not in the lexicon yet. This adds them.'));
  const budget = Number(await ask(`How many missing-but-referenced words to add? ${C.dim('[20]')} `)) || 20;
  const wish = resolve(CACHE, `expand-${Date.now()}.jsonl`);
  sh('interconnect.mjs', ['--dangling-out', wish]);
  let words;
  try { words = readFileSync(wish, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { words = []; }
  if (!words.length) { console.log(C.yellow('Nothing to grow into yet - add some synonyms/antonyms first.')); return; }
  const slice = words.slice(0, budget);
  console.log(`Found ${C.green(String(words.length))} referenced-but-missing word(s); taking ${C.b(String(slice.length))}.`);
  if (!(await confirm(`Add + connect these ${slice.length}? ${C.dim('[y/N]')} `))) return;
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(wish, slice.map((w) => JSON.stringify(w)).join('\n') + '\n');
  sh('draft_from_wishlist.mjs', ['--wishlist', wish]);
  sh('promote_drafts.mjs', ['--apply']);
  sh('generate_pack_forms.mjs', [], 'pipeline'); // new lexemes need their source forms (RH-18)
  sh('interconnect.mjs', ['--apply']);
  sh('review_autopromote.mjs', ['--apply']);
}

// 5. AUTOPILOT - runs on its own: fill → publish → push, chunk by chunk. Sensible defaults,
// press Enter to go; type 't' only if you want to change them. No flags, no commands.
async function doFix() {
  console.log(C.dim('\nThe autopilot fills missing definitions, synonyms and examples in small chunks,'));
  console.log(C.dim('resting the GPU between them, and publishes + pushes after each chunk so the app'));
  console.log(C.dim('fills in live. Leave it running; it stops on its own when nothing is left.'));
  let cd = 25, chunk = 20, each = true, push = true;
  const tune = (await ask('\n' + C.b('Press Enter to start') +
    C.dim('  (auto-publish + auto-push · 20 words/chunk · 25s rest)') +
    C.dim('  - or type ') + C.cyan('t') + C.dim(' to change settings: '))).toLowerCase();
  if (tune === 't') {
    cd = Number(await ask(`Rest between chunks, seconds? ${C.dim('[25]')} `)) || 25;
    chunk = Number(await ask(`Words per chunk? ${C.dim('[20]')} `)) || 20;
    each = (await ask(`Publish after each chunk (app fills in live)? ${C.dim('[Y/n]')} `)).toLowerCase() !== 'n';
    push = each && (await ask(`Push each chunk to GitHub? ${C.dim('[Y/n]')} `)).toLowerCase() !== 'n';
  }
  console.log(push
    ? C.yellow('\n⬆ PUSH LIVE') + C.dim(`: commits + pushes to GitHub ${each ? 'after each chunk - the app sees it as it goes.' : 'at the end.'}`)
    : C.dim('\n· LOCAL ONLY: nothing is pushed to GitHub. Use Publish to ship when ready.'));
  console.log(C.green('Starting autopilot...') + C.dim('  (Ctrl-C to stop - it resumes where it left off)'));
  sh('autopilot.mjs', ['--no-seed', '--yes', '--cooldown', String(cd), '--chunk', String(chunk),
    ...(each ? ['--publish-each'] : ['--build']), ...(push ? ['--push'] : [])]);
}

// 6. REVIEW - walk the needs_review items, approve/reject (no AI).
async function doReview() {
  const data = read();
  const pending = (data.concept_definitions || []).filter((d) => d.review_status === 'needs_review');
  if (!pending.length) { console.log(C.green('\nNothing waiting for review. ✅')); return; }
  console.log(`\n${C.b(String(pending.length))} item(s) awaiting review.  ` + C.dim('a = approve, r = reject (clears it), s = skip, q = stop'));
  let changed = 0;
  for (const d of pending) {
    const cid = typeof d.concept_id === 'object' ? d.concept_id.id : d.concept_id;
    console.log('\n' + C.cyan(`[${d.lang}]`) + ' ' + C.dim(cid));
    console.log('  ' + C.b(d.short_definition ?? C.dim('(no definition)')));
    console.log('  ' + C.dim('synonyms: ') + JSON.stringify(d.synonyms_json || []) + C.dim('  antonyms: ') + JSON.stringify(d.antonyms_json || []));
    const a = (await ask('  ' + C.cyan('[a]') + 'pprove / ' + C.cyan('[r]') + 'eject / ' + C.cyan('[s]') + 'kip / ' + C.cyan('[q]') + 'uit: ')).toLowerCase();
    if (a === 'q') break;
    if (a === 'a') { d.review_status = 'reviewed'; changed++; }
    else if (a === 'r') { d.short_definition = null; d.synonyms_json = []; d.antonyms_json = []; d.review_status = 'reviewed'; changed++; }
  }
  if (changed && (await confirm(`\nSave ${C.b(String(changed))} change(s)? ${C.dim('[y/N]')} `))) { writeFileSync(CONTENT, JSON.stringify(data, null, 2) + '\n'); console.log(C.green('Saved.')); }
}

// 7. STATUS - audit + interconnection report.
async function doStatus() {
  sh('content_report.mjs', []);
  sh('interconnect.mjs', []);
}

// 8. PUBLISH - gate + build + push.
async function doPublish() {
  console.log(C.dim('\nThis approves the clean AI content, rebuilds the packs, and (optionally) pushes to'));
  console.log(C.dim('GitHub so the app can update via ') + C.yellow('pnpm run refresh') + C.dim('.'));
  if (!(await confirm(C.b('Approve clean content + build packs?') + ` ${C.dim('[y/N]')} `))) return;
  sh('review_autopromote.mjs', ['--apply']);
  sh('rebuild_runtime_packs.mjs', ['--with-distribution'], 'pipeline');
  if (await confirm('Push to GitHub now? ' + C.dim('[y/N]') + ' ')) gitPush();
  else console.log(C.dim('Built locally - not pushed.'));
}
function gitPush() {
  console.log('\n' + C.cyan('- git push -'));
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  commitAndPush(REPO, { tag: `${ts} · console`, push: true }); // detailed message - see content_diff.mjs
  console.log(C.yellow('⬆ PUSHED LIVE to GitHub') + C.dim(' - the app updates via ') + C.yellow('pnpm run refresh') + C.dim('.'));
}

// ---- shared: add words through the existing engine, then link + gate ----
async function addWords(items) {
  mkdirSync(CACHE, { recursive: true });
  const wish = resolve(CACHE, `console-${Date.now()}.jsonl`);
  writeFileSync(wish, items.map((i) => JSON.stringify(i)).join('\n') + '\n');
  console.log(C.dim(`\nAdding ${items.length} word(s)...`));
  sh('draft_from_wishlist.mjs', ['--wishlist', wish]);
  sh('promote_drafts.mjs', ['--apply']);
  sh('generate_pack_forms.mjs', [], 'pipeline'); // new lexemes need their source forms (RH-18)
  sh('interconnect.mjs', ['--apply']);
  sh('review_autopromote.mjs', ['--apply']);
  console.log(C.green('Done.') + C.dim(' Saved LOCALLY - nothing pushed to GitHub yet (use Publish to ship).'));
  console.log(C.dim(' See the ✅/👀/✋ triage above. Richer synonyms/examples come from Autopilot.'));
}

// ---- AI helpers (the only model-facing logic here) ----
async function proposeWords(lang, level, n) {
  const model = await resolveModel();
  const res = await chat({
    system: 'You are a CEFR vocabulary expert. Output STRICT JSON only.',
    user: `Propose ${n} common, distinct CEFR ${level} ${langName(lang)} headwords for a learner. Lemmas only; for nouns in gendered languages include the definite article (e.g. German der/die/das, Italian il/la/lo). Avoid rare/specialized terms and multi-word phrases. Return JSON: {"words":["...", ...]}.`
  }, model);
  return (Array.isArray(res?.words) ? res.words : []).map((w) => String(w).trim()).filter(Boolean);
}
async function correctWord(word) {
  const model = await resolveModel();
  return chat({
    system: `You are a multilingual (${langList()}) lexicographer. Output STRICT JSON only.`,
    user: `The user typed "${word}". Do two things: (1) if misspelled, correct it to the intended real word; (2) reduce it to its DICTIONARY CITATION FORM (the lemma) - a verb to its infinitive (e.g. German geworfen -> werfen, lief -> laufen), a noun to its base/singular (e.g. German Haeuser -> Haus), an inflected adjective to its base form (e.g. German besseren -> besser). KEEP separable/inseparable verb prefixes (e.g. German herausfinden stays herausfinden, NEVER finden; aufstehen stays aufstehen). Put that citation form in "corrected". Then identify language (one of: ${LANGS.join(', ')}), part of speech, and list its distinct senses as short glosses. Return JSON: {"corrected":"<citation form>","lang":"${LANGS.join('|')}","pos":"...","senses":["...", ...],"unknown":false}. If it is not a real word in any of these languages, return {"unknown":true}.`
  }, model);
}

// ---- engine call + console helpers ----
function sh(script, argv, where = 'scripts') {
  const base = where === 'pipeline' ? resolve(REPO, 'tools/pipeline') : SCRIPTS;
  const r = spawnSync(process.execPath, [resolve(base, script), ...argv], { stdio: 'inherit', cwd: REPO });
  if (r.status !== 0) console.log(C.yellow(`  (step ${script} exited ${r.status})`));
}
// Headless autopilot: hand the flags straight to the engine. Drop --auto (our switch),
// and default to --yes so a headless run never blocks on a prompt.
function runAutopilot(raw) {
  const flags = raw.filter((a) => a !== '--auto');
  if (!flags.includes('--yes') && !flags.includes('-y')) flags.push('--yes');
  sh('autopilot.mjs', flags);
}
// Self-check on entry: heal duplicate / unscored / formless content so the next
// Publish can't ship a pack the app rejects. No-op on a clean repo. Same checks
// the autopilot runs headless; `pnpm run doctor` runs them on demand.
function healOnStartup() {
  let content;
  try { content = read(); } catch { return; }
  const issues = diagnoseContent(content);
  if (!issues.length) { console.log(C.dim('\nHealth check: ') + C.green('content OK ✓')); return; }
  console.log('\n' + C.yellow('Health check - fixing content problems:'));
  for (const i of issues) console.log('  ' + C.yellow('•') + ' ' + i.label + C.dim(`  ×${i.count}`));
  const { fixes, needsFormGen } = repairContent(content);
  if (fixes.length) {
    writeFileSync(CONTENT, JSON.stringify(content, null, 2) + '\n');
    for (const f of fixes) console.log('  ' + C.green('✓ ') + f);
  }
  if (needsFormGen) {
    console.log(C.dim('  minting missing forms...'));
    sh('generate_pack_forms.mjs', [], 'pipeline');
    console.log('  ' + C.green('✓ ') + 'forms generated');
  }
  console.log(C.green('  content fixed - use Publish to ship it.'));
}

function read() { return JSON.parse(readFileSync(CONTENT, 'utf8')); }
function readManifest() { return JSON.parse(readFileSync(MANIFEST, 'utf8')); }
function key(s) { return stripArticle(normalizeSearch(s)); }
// A concept_id may be a plain string or a relation object {id}; normalize to the string id.
const cidOf = (v) => (v && typeof v === 'object') ? (v.id ?? String(v)) : String(v);
// Editor identity for human-edit provenance: the git user.name (never the email). 'human' if unset.
function gitEditor() {
  try { return String(spawnSync('git', ['config', 'user.name'], { encoding: 'utf8' }).stdout || '').trim() || 'human'; }
  catch { return 'human'; }
}
function surfaceSet(lang) {
  const set = new Set();
  for (const lx of read().lexemes || []) if (String(lx.lang).toLowerCase() === lang) { set.add(key(lx.text)); set.add(key(lx.lemma)); }
  return set;
}
function ask(q) { return new Promise((res) => { const rl = createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); res(String(a).trim()); }); }); }
async function confirm(q) { return (await ask(q)).toLowerCase().startsWith('y'); }
async function pick(label, opts) { const i = await menu(label, opts); return opts[i] ?? opts[0]; }
async function menu(title, opts) {
  console.log('\n' + C.b(title) + C.dim(':'));
  opts.forEach((o, i) => console.log(`  ${C.cyan(String(i + 1))}) ${o}`));
  const n = parseInt(await ask(C.cyan('> ')), 10);
  return n >= 1 && n <= opts.length ? n - 1 : -1;
}
async function askMulti(title, items) {
  console.log('\n' + C.b(title));
  items.forEach((o, i) => console.log(`  ${C.cyan(String(i + 1))}) ${o}`));
  const a = (await ask(C.dim('keep - e.g. ') + '1,3,5' + C.dim(' / ') + 'all' + C.dim(' / ') + 'none' + C.dim(': '))).toLowerCase();
  if (a === 'all') return items.slice();
  if (a === 'none' || !a) return [];
  return [...new Set(a.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => n >= 1 && n <= items.length))].map((n) => items[n - 1]);
}

main().catch((e) => { console.error('\n' + C.red('FATAL: ' + (e?.message ?? e))); process.exit(1); });
