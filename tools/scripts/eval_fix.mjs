// Best-of-N + LLM judge for fixing EXISTING concepts - EPIC-ED-01 / MT-C2.
//
// Generates the needed fields (definitions / synonyms / antonyms / examples) from
// SEVERAL models, machine-scrubs each candidate (spoilers, headword, gibberish in
// lists), then a JUDGE model picks the best value PER FIELD (or "none" if all are
// wrong - empty beats wrong). The judge catches what rules can't: wrong language,
// gibberish, subtly-wrong definitions. Winners are written with review_status:
// needs_review. Preview by default; --apply writes content.json; never commits.
//
//   node tools/scripts/eval_fix.mjs --models <model-a>,<model-b> --spoilers --limit 10
//   node tools/scripts/eval_fix.mjs --models <model-a>,<model-b> --judge <model-c> --limit 20 --apply
//
// Filters: --spoilers · --missing-synonyms · --missing-examples ·
//   --level <L> · --limit <n>. Plus: --models a,b[,c] (required) · --judge <name>
//   (default: best installed) · --delay <ms>.

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  LLM_HOST, resolveModel, listChatModels, printModelRanking, chat, hasSpoiler, judgeBestFields,
  normalizeSearch, stripArticle, asString as str, AI_PROVENANCE
} from '../lib/authoring_core.mjs';
import { loadBandit, saveBandit, selectCommittee, recordDuels, ranking, formatRanking } from '../lib/model_bandit.mjs';
import { C } from '../lib/colors.mjs';
import { LANGS, langList } from '../lib/languages.mjs';

const CONTENT = resolve(process.cwd(), 'packs/lexicon_source/content.json');
const args = parseArgs(process.argv.slice(2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

main().catch((e) => { console.error('FATAL:', e?.message ?? e); process.exit(1); });

async function main() {
  if (args.listModels) return printModelRanking();
  const state = loadBandit();
  const allChat = (await listChatModels()).map((m) => m.name);
  if (args.ranking) {
    console.log(`Bandit standings - ${allChat.length} installed text model(s), by judge-preference win-rate:\n${formatRanking(ranking(state, allChat))}`);
    console.log('\n(Posterior mean; "unproven" = never run yet. The committee samples from these each run.)');
    return;
  }
  // Dynamic model selection - NO hardcoded names. Priority:
  //   --models <list> → exactly those (manual override)
  //   --all           → every installed text model (full tournament / seeding the bandit)
  //   default         → a dueling-bandit COMMITTEE: Thompson-sample K of N so the best
  //                     models run most, weak ones rarely, new ones get explored. The
  //                     committee is fixed for the whole run (one model load each) and
  //                     exploration happens ACROSS runs - kind to the GPU.
  if (allChat.length < 2 && !args.models?.length) { console.log(`Need ≥2 text models; found ${allChat.length}. Pull another or pass --models.`); return; }
  const seeded = !!state.updated; // has the bandit ever learned anything?
  if (args.models?.length) {
    /* explicit override - keep as given */
  } else if (args.all || !seeded) {
    // Cold start: the first time (no bandit history) it benchmarks ALL models on its
    // own to seed the ranking; after that it follows the bandit. --all forces a re-seed.
    args.models = allChat;
    console.log(seeded
      ? `--all - running every installed text model (${allChat.length}): ${allChat.join(', ')}`
      : `First run - benchmarking all ${allChat.length} installed models to seed the ranking (next runs auto-pick the best few): ${allChat.join(', ')}`);
  } else {
    const k = Math.min(args.committee ?? 3, allChat.length);
    const { committee } = selectCommittee(allChat, state, k);
    args.models = committee;
    const note = committee.map((m) => `${m}${!state.models[m]?.trials ? ' (new)' : ''}`).join(', ');
    console.log(`Bandit committee - ${k} of ${allChat.length} models (${allChat.length - k} sit out this run): ${note}`);
    console.log(`Standings so far (judge-preference win-rate):\n${formatRanking(ranking(state, allChat))}`);
  }
  if (args.models.length < 2) { console.log(`Need ≥2 models for a bake-off; got ${args.models.length}. Use --committee 2+ or --models a,b.`); return; }

  const data = JSON.parse(readFileSync(CONTENT, 'utf8'));
  const cidOf = (x) => (x && typeof x === 'object' ? x.id : x);
  const lexBy = group(data.lexemes, (l) => l.concept_id);
  const defBy = group(data.concept_definitions, (d) => cidOf(d.concept_id));
  const exBy = group(data.examples, (e) => cidOf(e.concept_id));
  const usedIds = new Set([...data.lexemes.map((l) => l.lexeme_id), ...data.examples.map((e) => e.example_id)]);
  const surfaces = (cid) => Object.fromEntries(LANGS.map((l) => [l, (lexBy.get(cid) || []).filter((x) => x.lang === l).flatMap((x) => [stripArticle(normalizeSearch(x.text)), normalizeSearch(x.lemma)]).filter(Boolean)]));
  const isSpoilerDef = (cid, def) => { const s = surfaces(cid); return hasSpoiler(def.short_definition, s[def.lang] || [], LANGS.filter((l) => l !== def.lang).flatMap((l) => s[l] || [])); };

  const targets = selectTargets(data, defBy, exBy, isSpoilerDef).slice(0, args.limit ?? Infinity);
  console.log(C.b(`${targets.length} word(s) to fill`) + C.dim(`  ·  ${args.models.length} model(s) compete, a judge keeps the best`));
  console.log(C.dim('  legend: definitions / synonyms / examples · DE=German IT=Italian EN=English'));
  if (targets.length === 0) { console.log('Nothing to do.'); return; }
  if (args.dryRun) { targets.forEach((t) => console.log(`  ${label(t.c, lexBy)} → defs[${t.defLangsToFix.join(',') || '-'}] ${t.needSyn ? 'syn ' : ''}${t.exMissing.length ? `ex[${t.exMissing.join(',')}]` : ''}`)); console.log('\nDry run - no model call.'); return; }

  // Phase 1 - generate candidates, batched by model (one model load per model).
  const labels = {}; // modelName -> A/B/C
  args.models.forEach((m, i) => (labels[m] = String.fromCharCode(65 + i)));
  const cand = new Map(); // conceptId -> { [model]: scrubbedRecord }
  for (const model of args.models) {
    const resolved = await resolveModel(model);
    console.log('\n' + C.cyan(`▸ candidate ${labels[model]}`) + C.dim(` (${resolved}) - drafting...`));
    for (const [i, t] of targets.entries()) {
      process.stdout.write(`  ${C.dim(`[${i + 1}/${targets.length}]`)} ${C.b(label(t.c, lexBy))} ... `);
      try {
        const out = await chat(buildPrompt(t.c, lexBy, defBy, t), resolved);
        const rec = scrub(out, surfaces(t.c.concept_id), t);
        if (!cand.has(t.c.concept_id)) cand.set(t.c.concept_id, {});
        cand.get(t.c.concept_id)[model] = rec;
        // Show WHAT the model produced (after scrub), in plain words.
        const up = (a) => a.map((l) => l.toUpperCase()).join(' ');
        const got = [];
        const dl = t.defLangsToFix.filter((l) => str(rec.definitions?.[l]).trim());
        if (dl.length) got.push(C.green('definitions ') + up(dl));
        const syl = t.synLangsToFix.filter((l) => rec.synonyms?.[l]?.length || rec.antonyms?.[l]?.length);
        if (syl.length) got.push(C.cyan('synonyms ') + up(syl));
        const el = t.exMissing.filter((l) => str(rec.examples?.[l]).trim());
        if (el.length) got.push(C.blue('examples ') + up(el));
        console.log(got.length ? got.join(C.dim(' · ')) : C.dim('nothing usable'));
      } catch (e) { console.log(C.red(`error: ${e?.message ?? e}`)); }
      if (args.delay && i < targets.length - 1) await sleep(args.delay);
    }
  }

  // Phase 2 - judge each concept, pick the best value per field.
  // Stable, strong judge: the largest installed model (allChat is size-desc), NOT the
  // random first committee member - so preferences stay comparable across runs.
  const judge = await resolveModel(args.judge ?? allChat[0]);
  console.log('\n' + C.cyan('▸ judge') + C.dim(` (${judge}) - picking the best of each...`));
  let fixedConcepts = 0, newDefs = 0, updDefs = 0, newEx = 0;
  const wins = new Map();
  const win = (m) => m && wins.set(m, (wins.get(m) || 0) + 1);
  const allDuels = []; // dueling-bandit feedback: who competed per field, who the judge picked
  for (const [i, t] of targets.entries()) {
    const c = t.c;
    const byModel = cand.get(c.concept_id) || {};
    process.stdout.write(`  ${C.dim(`[${i + 1}/${targets.length}]`)} ${C.b(label(c, lexBy))} ... `);
    const winner = await pickWinners(c, t, byModel, labels, judge, lexBy);
    allDuels.push(...winner._duels);
    let touched = false;

    for (const l of t.defLangsToFix) {
      const def = str(winner.definitions?.[l]).trim();
      if (!def) continue;
      const by = winner._models[`definitions.${l}`];
      const cf = winner._conf[`definitions.${l}`] ?? 'medium';
      const row = (defBy.get(c.concept_id) || []).find((d) => d.lang === l);
      if (row) { row.short_definition = def; row.source = 'ai'; row.generated_by = AI_PROVENANCE; row.confidence = cf; row.review_status = 'needs_review'; updDefs++; }
      else { const nd = mkDef(c.concept_id, l, def, AI_PROVENANCE, cf); data.concept_definitions.push(nd); defBy.set(c.concept_id, [...(defBy.get(c.concept_id) || []), nd]); newDefs++; }
      win(by); touched = true;
    }
    for (const l of t.synLangsToFix) {
      const syn = winner.synonyms?.[l] ?? [];
      const ant = winner.antonyms?.[l] ?? [];
      if (!syn.length && !ant.length) continue;
      const by = winner._models[`synonyms.${l}`] ?? winner._models[`antonyms.${l}`] ?? winner._models[`definitions.${l}`];
      const cf = winner._conf[`synonyms.${l}`] ?? winner._conf[`antonyms.${l}`] ?? 'medium';
      let def = (defBy.get(c.concept_id) || []).find((d) => d.lang === l);
      if (!def) { def = mkDef(c.concept_id, l, null, AI_PROVENANCE, cf); data.concept_definitions.push(def); defBy.set(c.concept_id, [...(defBy.get(c.concept_id) || []), def]); }
      def.synonyms_json = [...new Set([...(def.synonyms_json || []), ...syn])];
      def.antonyms_json = [...new Set([...(def.antonyms_json || []), ...ant])];
      def.generated_by = def.generated_by ?? AI_PROVENANCE;
      def.confidence = cf;
      def.review_status = 'needs_review';
      win(winner._models[`synonyms.${l}`]); win(winner._models[`antonyms.${l}`]); touched = true;
    }
    for (const l of t.exMissing) {
      const ex = str(winner.examples?.[l]).trim();
      if (!ex) continue;
      const by = winner._models[`examples.${l}`];
      const cf = winner._conf[`examples.${l}`] ?? 'medium';
      data.examples.push({ example_id: uniq(`example-${l}-fix-${slug(c, lexBy)}`, usedIds), concept_id: c.concept_id, lang: l, sentence: ex, source: 'ai', generated_by: AI_PROVENANCE, confidence: cf, notes: null, review_status: 'needs_review' });
      win(by); newEx++; touched = true;
    }
    if (touched) { c.review_status = 'needs_review'; fixedConcepts++; }
    console.log(touched ? C.green('✓ kept ') + winner._summary : C.dim('nothing kept (all rejected)'));
    if (args.delay && i < targets.length - 1) await sleep(args.delay);
  }

  console.log('\n' + C.green(`✓ ${fixedConcepts} word(s) updated`) + C.dim(`  ·  +${newDefs} definitions, ${updDefs} rewritten, +${newEx} examples`));
  const winRank = [...wins.entries()].sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m}: ${n}`).join(' · ');
  if (winRank) console.log(C.dim(`  model wins this batch: ${winRank}`));
  // Feed this run's judge preferences back into the dueling bandit (learning happens
  // whether or not we --apply - the judgement is real either way), persist, show standings.
  recordDuels(state, allDuels);
  saveBandit(state);
  const realDuels = allDuels.filter((d) => d.participants.length >= 2).length;
  console.log(`\nBandit updated from ${realDuels} duel(s). Cumulative standings (judge-preference win-rate, all runs):\n${formatRanking(ranking(state, allChat))}`);
  if (!args.apply) { console.log('\nPreview only - no file written. Re-run with --apply, then review the git diff.'); return; }
  writeFileSync(CONTENT, JSON.stringify(data, null, 2) + '\n');
  console.log('\nWrote content.json. Review:  git diff packs/lexicon_source/content.json   then commit.');
}

/** Build the per-field options across models, ask the judge, map labels → values. */
async function pickWinners(c, t, byModel, labels, judge, lexBy) {
  const fields = [];
  const addField = (path, get) => {
    const options = {};
    for (const m of args.models) { const v = get(byModel[m]); if (v && (!Array.isArray(v) || v.length)) options[labels[m]] = v; }
    if (Object.keys(options).length) fields.push({ path, options, get });
  };
  for (const l of t.defLangsToFix) addField(`definitions.${l}`, (r) => str(r?.definitions?.[l]).trim());
  for (const l of t.synLangsToFix) { addField(`synonyms.${l}`, (r) => r?.synonyms?.[l] ?? []); addField(`antonyms.${l}`, (r) => r?.antonyms?.[l] ?? []); }
  for (const l of t.exMissing) addField(`examples.${l}`, (r) => str(r?.examples?.[l]).trim());

  const lx = (l) => (lexBy.get(c.concept_id) || []).find((x) => x.lang === l)?.text ?? '?';
  const verdict = await judgeBestFields({ wordLine: `de="${lx('de')}" it="${lx('it')}" en="${lx('en')}"`, fields }, judge);

  const out = { definitions: {}, synonyms: {}, antonyms: {}, examples: {}, _models: {}, _conf: {}, _duels: [], _summary: '' };
  const picks = [];
  const modelOf = Object.fromEntries(Object.entries(labels).map(([m, l]) => [l, m]));
  const catOf = (p) => (p.startsWith('definitions.') ? 'definition' : p.startsWith('examples.') ? 'example' : p.startsWith('synonyms.') ? 'synonyms' : p.startsWith('antonyms.') ? 'antonyms' : p);
  for (const f of fields) {
    // Every field is a duel: participants = models that offered a candidate, winner = the judge's pick (or none).
    const participants = Object.keys(f.options).map((lab) => modelOf[lab]).filter(Boolean);
    const lab = verdict[f.path];
    const model = lab && lab !== 'none' && modelOf[lab] ? modelOf[lab] : null;
    out._duels.push({ cat: catOf(f.path), participants, winner: model });
    if (!model) continue;
    const val = f.get(byModel[model]);
    if (f.path.startsWith('definitions.')) out.definitions[f.path.split('.')[1]] = val;
    else if (f.path.startsWith('examples.')) out.examples[f.path.split('.')[1]] = val;
    else if (f.path.startsWith('synonyms.')) out.synonyms[f.path.split('.')[1]] = val;
    else if (f.path.startsWith('antonyms.')) out.antonyms[f.path.split('.')[1]] = val;
    else out[f.path] = val;
    out._models[f.path] = model; // per-field provenance: which model won this field
    out._conf[f.path] = Object.keys(f.options).length >= 2 ? 'high' : 'medium'; // ≥2 models offered + judge vetted → high confidence
    picks.push(`${f.path.replace('definitions.', 'd.').replace('examples.', 'e.')}=${lab}`);
  }
  out._summary = picks.join(' ') || 'none';
  return out;
}

function buildPrompt(c, lexBy, defBy, t) {
  const lx = (l) => (lexBy.get(c.concept_id) || []).find((x) => x.lang === l)?.text ?? '?';
  const existingDef = (l) => (defBy.get(c.concept_id) || []).find((d) => d.lang === l)?.short_definition ?? '';
  const system = [
    `You are a meticulous multilingual (${langList()}) lexicographer. Output STRICT JSON only.`,
    'NO SPOILERS - a definition/example for a language MUST NOT contain the headword, an inflection of it, or its translation in another language; examples use the word in their OWN language only.',
    'BETTER EMPTY THAN WRONG - leave a field empty ("" or []) if you cannot write a short, accurate, spoiler-free value. Never guess, never write filler, never use foreign words.',
    'synonyms[lang] = the OTHER accepted answers for this headword in that language. For the headword\'s OWN language: true lexical synonyms. For the OTHER languages: ALL its common translations, INCLUDING its distinct meanings - one word often maps to several different words (e.g. German halten -> Italian tenere, reggere, fermare, mantenere, durare). Citation form, different words, NOT inflections. [] if none.',
    'antonyms[lang] = direct opposites in that language. [] if none.'
  ].join('\n');
  const ask = [];
  if (t.defLangsToFix.length) ask.push(`- definitions for: ${t.defLangsToFix.join(', ')}`);
  if (t.synLangsToFix.length) ask.push(`- synonyms and antonyms for: ${t.synLangsToFix.join(', ')}`);
  if (t.exMissing.length) ask.push(`- examples for: ${t.exMissing.join(', ')}`);
  const user = [
    `CONCEPT [${c.pos ?? '?'}, ${c.level_override || c.level_auto}]: de="${lx('de')}" · it="${lx('it')}" · en="${lx('en')}"`,
    `Existing definitions - de: "${existingDef('de')}" · it: "${existingDef('it')}" · en: "${existingDef('en')}"`,
    '', 'PROVIDE only these (fill what you can, leave the rest empty):', ...ask, '',
    'Return JSON EXACTLY: {"definitions":{"de":"","it":"","en":""},"synonyms":{"de":[],"it":[],"en":[]},"antonyms":{"de":[],"it":[],"en":[]},"examples":{"de":"","it":"","en":""}}'
  ].join('\n');
  return { system, user };
}

/** Machine-scrub a raw candidate: blank spoiler defs/examples, clean syn/ant lists. */
function scrub(out, s, t) {
  if (out.parse_error) return { definitions: {}, synonyms: {}, antonyms: {}, examples: {} };
  const other = (l) => LANGS.filter((x) => x !== l).flatMap((x) => s[x] || []);
  const r = { definitions: {}, synonyms: {}, antonyms: {}, examples: {} };
  for (const l of t.defLangsToFix) { let d = str(out.definitions?.[l]).trim(); if (d && hasSpoiler(d, s[l] || [], other(l))) d = ''; r.definitions[l] = d; }
  for (const l of t.synLangsToFix) { r.synonyms[l] = cleanList(out.synonyms?.[l], s[l] || []); r.antonyms[l] = cleanList(out.antonyms?.[l], s[l] || []); }
  for (const l of t.exMissing) { let e = str(out.examples?.[l]).trim(); if (e && hasSpoiler(e, [], other(l))) e = ''; r.examples[l] = e; }
  return r;
}

function selectTargets(data, defBy, exBy, isSpoilerDef) {
  const out = [];
  for (const c of data.concepts) {
    if (args.level && (c.level_override || c.level_auto) !== args.level) continue;
    const cdefs = defBy.get(c.concept_id) || [];
    const spoilLangs = cdefs.filter((d) => isSpoilerDef(c.concept_id, d)).map((d) => d.lang);
    const emptyDefLangs = LANGS.filter((l) => !cdefs.find((d) => d.lang === l && str(d.short_definition).trim()));
    const exLangs = new Set((exBy.get(c.concept_id) || []).map((e) => e.lang));
    const exMissing = LANGS.filter((l) => !exLangs.has(l));
    const anyFilter = args.spoilers || args.missingSynonyms || args.missingExamples;
    const defLangsToFix = (args.spoilers || !anyFilter) ? [...new Set([...spoilLangs, ...(anyFilter ? [] : emptyDefLangs)])] : [];
    // Per LANGUAGE: a lang needs synonyms when it has a real definition but no
    // synonyms yet. (Was German-only - which left every Italian/English answer with
    // no accepted alternatives, so valid translations like "comparare" were wrong.)
    const synLangsToFix = (args.missingSynonyms || !anyFilter)
      ? LANGS.filter((l) => {
          const def = cdefs.find((d) => d.lang === l);
          return def && str(def.short_definition).trim() && !(def.synonyms_json || []).length;
        })
      : [];
    const exToFill = (args.missingExamples || !anyFilter) ? exMissing : [];
    if (defLangsToFix.length || synLangsToFix.length || exToFill.length) out.push({ c, defLangsToFix, synLangsToFix, exMissing: exToFill });
  }
  return out;
}

function mkDef(concept_id, lang, short, generatedBy, confidence) { return { concept_id, lang, short_definition: short, usage_note: null, context_tags_json: [], source: 'ai', generated_by: generatedBy ?? null, confidence: confidence ?? 'medium', synonyms_json: [], antonyms_json: [], antonym_policy_json: null, hint_text: null, review_status: 'needs_review' }; }
function cleanList(arr, headSurfaces) {
  const heads = new Set(headSurfaces);
  return [...new Set((Array.isArray(arr) ? arr : []).map((w) => String(w).trim()).filter(Boolean)
    .filter((w) => !/[^\p{Script=Latin}\p{P}\s\d]/u.test(w)).filter((w) => !heads.has(stripArticle(normalizeSearch(w)))))];
}
function label(c, lexBy) { return (lexBy.get(c.concept_id) || []).find((l) => l.lang === 'de')?.text ?? c.concept_id.slice(0, 10); }
function slug(c, lexBy) { return normalizeSearch((lexBy.get(c.concept_id) || []).find((l) => l.lang === 'de')?.lemma ?? c.concept_id).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'item'; }
function uniq(id, used) { if (!used.has(id)) { used.add(id); return id; } let i = 2; while (used.has(`${id}-${i}`)) i++; const r = `${id}-${i}`; used.add(r); return r; }
function group(a, f) { const m = new Map(); for (const x of a) { const k = f(x); (m.get(k) ?? m.set(k, []).get(k)).push(x); } return m; }
function parseArgs(argv) {
  const o = { apply: false, dryRun: false, listModels: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') o.apply = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--list-models') o.listModels = true;
    else if (a === '--ranking') o.ranking = true;
    else if (a === '--all') o.all = true;
    else if (a === '--committee') o.committee = Number(argv[++i]);
    else if (a === '--spoilers') o.spoilers = true;
    else if (a === '--missing-synonyms') o.missingSynonyms = true;
    else if (a === '--missing-examples') o.missingExamples = true;
    else if (a === '--level') o.level = argv[++i];
    else if (a === '--models') o.models = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--judge') o.judge = argv[++i];
    else if (a === '--limit') o.limit = Number(argv[++i]);
    else if (a === '--delay') o.delay = Number(argv[++i]);
  }
  return o;
}
