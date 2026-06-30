// Assign a correctness TIER (exact / close / loose) to each accepted synonym, so the
// app can give partial credit + a learning note (GEN-09, translation weights). The LLM
// judge rates how interchangeable each alternative is with the concept's primary answer.
//
// Writes concept_definitions[].synonym_tiers_json = { "<synonym>": "exact" | "loose" }.
// "close" is the DOCUMENTED DEFAULT (CONTRACT.md) and is left ABSENT, so the map records
// only the exceptions. A definition reviewed but all-close gets `{}` - the "reviewed"
// marker - so re-runs skip it. A human-set tier is never overwritten.
//
// Preview by default; --apply writes content.json; NEVER commits. Resumable: flushes
// progress every few writes and on SIGINT (Ctrl-C), so a long run loses nothing.
//
//   node tools/scripts/tier_synonyms.mjs                 # preview what would be tiered
//   node tools/scripts/tier_synonyms.mjs --apply         # rate + write synonym_tiers_json
//   node tools/scripts/tier_synonyms.mjs --apply --limit 20 --delay 800   # one paced chunk
//   node tools/scripts/tier_synonyms.mjs --apply --judge <model>          # force a judge model

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { langName, langList } from '../lib/languages.mjs';
import { chat, resolveModel, listChatModels, asString as str } from '../lib/authoring_core.mjs';

const CONTENT = resolve(process.cwd(), 'packs/lexicon_source/content.json');

// The tier vocabulary is a closed enum (a genuine constant, not data): exact = fully
// interchangeable, close = very near (the default), loose = acceptable but a real difference.
export const TIERS = ['exact', 'close', 'loose'];
const DEFAULT_TIER = 'close';

/** Coerce any model output to a valid tier; anything unknown becomes the default ("close"). */
export function coerceTier(value) {
  const t = str(value).trim().toLowerCase();
  return TIERS.includes(t) ? t : DEFAULT_TIER;
}

/** Parse a *_json field that may be an array or a JSON-encoded string. */
export function toArr(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** A definition needs a tiering pass when it has synonyms but no tiers map yet
 *  (synonym_tiers_json === undefined). Once reviewed it carries a map (possibly {}),
 *  so it is skipped; synonyms added later default to "close" until a forced re-tier. */
export function needsTiering(def) {
  return toArr(def.synonyms_json).length > 0 && def.synonym_tiers_json === undefined;
}

/** Keep only the non-default tiers (exact / loose); "close" is implied by absence.
 *  Preserves any pre-existing tiers (a human edit wins over the model). */
export function tiersToStore(synonyms, rated, existing = {}) {
  const out = { ...(existing && typeof existing === 'object' ? existing : {}) };
  for (const syn of synonyms) {
    if (syn in out) continue; // never overwrite an existing (e.g. human) tier
    const tier = coerceTier(rated?.[syn]);
    if (tier !== DEFAULT_TIER) out[syn] = tier;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const data = JSON.parse(readFileSync(CONTENT, 'utf8'));

  const conceptPrimary = buildConceptPrimaryIndex(data);
  let work = (data.concept_definitions || []).filter(needsTiering);
  if (args.limit) work = work.slice(0, args.limit);

  console.log(`${work.length} definition(s) with untiered synonyms` + (args.limit ? ` (limited to ${args.limit})` : '') + '.');
  if (work.length === 0) return;

  // Only --apply calls the LLM, so only --apply needs a model resolved.
  const model = args.apply ? await resolveModel(args.judge ?? args.model ?? (await listChatModels())[0]?.name) : null;
  if (args.apply && !model) { console.log('No local chat model available - is the LLM host running?'); return; }
  if (model) console.log(`Judge: ${model}\n`);

  const total = work.length;
  const started = Date.now();
  let done = 0, written = 0, sinceSave = 0;
  const save = () => { if (args.apply && written > 0) writeFileSync(CONTENT, JSON.stringify(data, null, 2) + '\n'); };
  process.on('SIGINT', () => { console.log('\nInterrupted - flushing progress...'); save(); process.exit(130); });

  for (const def of work) {
    done++;
    const synonyms = toArr(def.synonyms_json);
    const label = conceptPrimary.get(def.concept_id)?.label ?? def.concept_id;
    const primary = conceptPrimary.get(def.concept_id)?.byLang?.[def.lang] ?? '';
    process.stdout.write(`[${done}/${total}] ${langName(def.lang)} "${primary || def.concept_id}" [${synonyms.length}] ... `);

    // Only --apply spends the GPU. Without it this is a free preview (no LLM call),
    // so a run without --apply can never silently burn time for nothing.
    if (!args.apply) { console.log('(preview - re-run with --apply to write)'); continue; }

    const rated = await rateTiers({ synonyms, label, primary, lang: def.lang }, model);
    if (!rated) { console.log('judge error - left for a later run' + etaSuffix(started, done, total)); continue; }

    const stored = tiersToStore(synonyms, rated, def.synonym_tiers_json);
    if (args.apply) {
      def.synonym_tiers_json = stored; // {} when all-close = the "reviewed" marker
      written++;
      if (++sinceSave >= 10) { save(); sinceSave = 0; }
    }
    const exceptions = Object.entries(stored);
    console.log((exceptions.length ? exceptions.map(([s, t]) => `${s}=${t}`).join(', ') : 'all close') + etaSuffix(started, done, total));
    if (args.delay) await sleep(args.delay);
  }

  save();
  const elapsedMin = ((Date.now() - started) / 60000);
  const avgSec = done > 0 ? ((Date.now() - started) / done / 1000) : 0;
  const timing = done > 0 ? ` in ${elapsedMin.toFixed(1)}m (avg ${avgSec.toFixed(1)}s/item over ${done})` : '';
  console.log(`\n${args.apply ? `Wrote tiers on ${written} definition(s)${timing}.` : `Preview only${timing} - re-run with --apply to write.`}`);
}

/** concept_id -> { label: "de:.. / it:.. / en:..", byLang: {lang: primaryText} } from primary lexemes. */
function buildConceptPrimaryIndex(data) {
  const index = new Map();
  for (const lex of data.lexemes || []) {
    if (lex.is_primary !== true) continue;
    const entry = index.get(lex.concept_id) ?? { byLang: {} };
    entry.byLang[lex.lang] = str(lex.text);
    index.set(lex.concept_id, entry);
  }
  for (const entry of index.values()) {
    entry.label = Object.entries(entry.byLang).map(([l, t]) => `${l}:${t}`).join(' / ');
  }
  return index;
}

async function rateTiers({ synonyms, label, primary, lang }, model) {
  const res = await chat({
    system: `You are a multilingual (${langList()}) lexicography reviewer. Output STRICT JSON only.`,
    user:
      `Concept (its words across languages): ${label}.\n` +
      `The primary ${langName(lang)} answer for this concept is "${primary}".\n` +
      `A learner studying this concept might instead type one of these ${langName(lang)} alternatives: ${JSON.stringify(synonyms)}.\n` +
      `Rate how interchangeable EACH alternative is with the primary answer FOR THIS CONCEPT:\n` +
      `"exact" = same meaning, fully interchangeable; "close" = very near, only a minor nuance or register difference; "loose" = a valid related answer but with a real difference in meaning or scope.\n` +
      `Reply with STRICT JSON mapping every alternative to its tier, e.g. {"word":"exact","phrase":"close"}. Include every alternative exactly as given.`,
  }, model);
  if (!res || res.parse_error || typeof res !== 'object') return null;
  const out = {};
  for (const syn of synonyms) out[syn] = coerceTier(res[syn]);
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Live ETA from the average time per completed item (empty for the first/last item). */
function etaSuffix(startedMs, done, total) {
  if (done <= 0 || done >= total) return '';
  const avgMs = (Date.now() - startedMs) / done;
  const leftMin = Math.max(1, Math.ceil((avgMs * (total - done)) / 60000));
  return `  (~${leftMin}m left)`;
}

function parseArgs(argv) {
  const o = { apply: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') o.apply = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--judge') o.judge = argv[++i];
    else if (a === '--limit') o.limit = Number(argv[++i]) || 0;
    else if (a === '--delay') o.delay = Number(argv[++i]) || 0;
  }
  return o;
}

// Only run main() as a CLI, not when imported by the test.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('tier_synonyms.mjs')) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
