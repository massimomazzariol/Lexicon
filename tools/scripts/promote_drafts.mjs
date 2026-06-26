// Promote clean AI drafts → packs/lexicon_source/content.json (VBR-160 MT-A).
//
// Auto-promotes drafts with ZERO guardrail issues; skips flagged / duplicate /
// ambiguous (those need a human). Writes content.json only with --apply; you then
// review `git diff packs/lexicon_source/content.json` and commit. It never commits.
//
// Record shape matches the hand-authored waves (tools/scripts/add_*_wave.mjs):
// concept + 3 lexemes (de/it/en) + 3 concept_definitions (per-language synonyms/
// antonyms live on each language's definition) + per-language examples. Provenance: source "ai".
//
// Usage:
//   node tools/scripts/promote_drafts.mjs                  # preview the latest drafts
//   node tools/scripts/promote_drafts.mjs --apply          # write content.json
//   node tools/scripts/promote_drafts.mjs --file <path> [--apply]

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { asString as str, AI_PROVENANCE } from '../lib/authoring_core.mjs';
import { defaultDifficultyForLevel } from '../lib/lexicon_conventions.mjs';

const REPO = process.cwd();
const CONTENT_PATH = resolve(REPO, 'packs/lexicon_source/content.json');
const DRAFTS_DIR = resolve(REPO, 'authoring/drafts');
// Every AI-promoted record carries this until a human verifies it. The future
// review console lists `review_status: needs_review` and flips them to reviewed.
const REVIEW_STATUS = 'needs_review';
const args = parseArgs(process.argv.slice(2));

main();

function main() {
  const file = args.file ? resolve(REPO, args.file) : latestDraftFile();
  if (!file || !existsSync(file)) {
    console.log('No drafts file found (authoring/drafts/*.jsonl). Run the drafter first.');
    return;
  }
  const drafts = readFileSync(file, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const data = JSON.parse(readFileSync(CONTENT_PATH, 'utf8'));
  const now = new Date().toISOString();

  const conceptIds = new Set(data.concepts.map((c) => c.concept_id));
  const lexKeys = new Set(data.lexemes.map((l) => `${l.concept_id}|${l.lang}|${norm(l.text)}`));
  const usedIds = new Set([
    ...conceptIds,
    ...data.lexemes.map((l) => l.lexeme_id),
    ...data.examples.map((e) => e.example_id)
  ]);

  const add = { concepts: [], lexemes: [], defs: [], examples: [] };
  const skipped = [];
  let attachLex = 0;

  for (const d of drafts) {
    const term = d.wishlist_term ?? '?';
    if (d.error || d.parse_error) {
      skipped.push(`${term}: error/parse_error`);
      continue;
    }
    if ((d.issues?.length ?? 0) > 0) {
      skipped.push(`${term}: ${d.issues.length} guardrail issue(s)`);
      continue;
    }
    const kind = d.match?.kind;

    if (kind === 'new') {
      const level = (d.concept?.level || 'A1').toLowerCase();
      const slug = slugify(d.lexemes?.de?.lemma || d.lexemes?.de?.text || term);
      const cid = uniq(`concept-${level}-${slug}`, usedIds);
      usedIds.add(cid);
      conceptIds.add(cid);
      add.concepts.push({
        concept_id: cid,
        pos: d.concept?.pos ?? null,
        // Auto-derived from the level (same contract as upsert) - never null, or
        // the app's importer rejects the concept (Invalid int for difficulty_score_auto).
        difficulty_score_auto: defaultDifficultyForLevel(d.concept?.level ?? 'A1'),
        level_auto: d.concept?.level ?? 'A1',
        level_override: null,
        domain_tags: d.concept?.domain_tags ?? [],
        notes: null,
        review_status: REVIEW_STATUS,
        metadata_json: { source: 'ai', generated_at: now }
      });
      for (const lang of ['de', 'it', 'en']) {
        const lx = d.lexemes?.[lang];
        if (!lx?.text) continue;
        const lid = uniq(`lexeme-${lang}-${level}-${slug}`, usedIds);
        usedIds.add(lid);
        add.lexemes.push(lexeme(lid, cid, lang, lx, true));
        lexKeys.add(`${cid}|${lang}|${norm(lx.text)}`);
        const shortDef = str(d.definitions?.[lang]).trim();
        const syn = d.synonyms?.[lang] ?? [];
        const ant = d.antonyms?.[lang] ?? [];
        // Skip empty definitions (empty beats wrong). Still create the def if it
        // carries synonyms/antonyms even without a short definition.
        if (shortDef || syn.length || ant.length) {
          add.defs.push({
            concept_id: cid,
            lang,
            short_definition: shortDef || null,
            usage_note: null,
            context_tags_json: [],
            source: 'ai',
            generated_by: AI_PROVENANCE,
            synonyms_json: syn,
            antonyms_json: ant,
            antonym_policy_json: null,
            hint_text: null,
            review_status: REVIEW_STATUS
          });
        }
        const ex = str(d.example?.[lang]).trim();
        if (ex) {
          const eid = uniq(`example-${lang}-${level}-${slug}`, usedIds);
          usedIds.add(eid);
          add.examples.push({ example_id: eid, concept_id: cid, lang, sentence: ex, source: 'ai', generated_by: AI_PROVENANCE, notes: null, review_status: REVIEW_STATUS });
        }
      }
    } else if (kind === 'attach') {
      const cid = d.match?.concept_id;
      if (!cid || !conceptIds.has(cid)) {
        skipped.push(`${term}: attach to unknown concept ${cid}`);
        continue;
      }
      const level = (d.concept?.level || 'A1').toLowerCase();
      const slug = slugify(d.lexemes?.de?.lemma || term);
      let added = 0;
      for (const lang of ['de', 'it', 'en']) {
        const lx = d.lexemes?.[lang];
        if (!lx?.text) continue;
        const key = `${cid}|${lang}|${norm(lx.text)}`;
        if (lexKeys.has(key)) continue; // surface already on the concept
        lexKeys.add(key);
        const lid = uniq(`lexeme-${lang}-${level}-${slug}`, usedIds);
        usedIds.add(lid);
        add.lexemes.push(lexeme(lid, cid, lang, lx, false));
        attachLex++;
        added++;
      }
      if (added === 0) skipped.push(`${term}: attach - all surfaces already present`);
    } else {
      skipped.push(`${term}: ${kind} (needs human)`);
    }
  }

  console.log(`Drafts: ${drafts.length} from ${file.replace(REPO, '.')}`);
  console.log(
    `Would add: ${add.concepts.length} concept(s), ${add.lexemes.length} lexeme(s)` +
      `${attachLex ? ` (incl. ${attachLex} attach)` : ''}, ${add.defs.length} definition(s), ${add.examples.length} example(s).`
  );
  if (skipped.length) console.log(`Skipped ${skipped.length}:\n  ${skipped.join('\n  ')}`);

  if (!args.apply) {
    console.log('\nPreview only. Re-run with --apply to write content.json, then review the git diff before committing.');
    return;
  }
  data.concepts.push(...add.concepts);
  data.lexemes.push(...add.lexemes);
  data.concept_definitions.push(...add.defs);
  data.examples.push(...add.examples);
  writeFileSync(CONTENT_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log('\nWrote content.json. Review:  git diff packs/lexicon_source/content.json   then commit.');
}

function lexeme(lexeme_id, concept_id, lang, lx, isPrimary) {
  return {
    lexeme_id,
    concept_id,
    lang,
    text: lx.text,
    lemma: lx.lemma || lx.text,
    is_primary: isPrimary,
    is_active: true,
    meaning_status: 'exact',
    frequency_rank: null,
    notes: null,
    source: 'ai',
    generated_by: AI_PROVENANCE,
    review_status: REVIEW_STATUS
  };
}

function latestDraftFile() {
  if (!existsSync(DRAFTS_DIR)) return null;
  const files = readdirSync(DRAFTS_DIR).filter((f) => f.endsWith('.jsonl')).sort();
  return files.length ? resolve(DRAFTS_DIR, files[files.length - 1]) : null;
}
function slugify(s) {
  return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
}
function norm(s) {
  return String(s ?? '').toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '').replace(/ß/g, 'ss').replace(/\s+/g, ' ').trim();
}
function uniq(id, used) {
  if (!used.has(id)) return id;
  let i = 2;
  while (used.has(`${id}-${i}`)) i++;
  return `${id}-${i}`;
}
function parseArgs(argv) {
  const o = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') o.apply = true;
    else if (argv[i] === '--file') o.file = argv[++i];
  }
  return o;
}
