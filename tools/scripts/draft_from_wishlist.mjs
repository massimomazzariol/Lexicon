// Wishlist → AI draft - VBR-160 MT-A.
//
// Reads authoring/WISHLIST.jsonl, asks a LOCAL model to draft a full
// concept record per term, checks whether the term already exists in
// packs/lexicon_source/content.json, runs machine guardrails, and writes
// proposals to authoring/drafts/draft-<ts>.jsonl for human review. It NEVER
// touches content.json - promotion is a separate, deliberate step.
//
// Portable: with no --model it auto-detects the models installed in the local
// LLM and picks the best one for lexical drafting (so it runs on any machine).
//
// Usage:
//   node tools/scripts/draft_from_wishlist.mjs --list-models        # what's installed + ranking
//   node tools/scripts/draft_from_wishlist.mjs --limit 5            # auto-pick model
//   node tools/scripts/draft_from_wishlist.mjs --model <name>       # force a model
//   node tools/scripts/draft_from_wishlist.mjs --dry-run --limit 3  # no model server; print prompts
//   LLM_HOST=http://gpu-box:11434 node tools/scripts/draft_from_wishlist.mjs
//
// Flags: --model <name> · --limit <n> · --list-models · --dry-run · --wishlist <path>

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { LANGS, langList } from '../lib/languages.mjs';
import { getAuthoringPlugin } from '../lib/language_plugins/authoring_plugins.mjs';
import {
  LLM_HOST, ARTICLES_BY_LANG, normalizeSearch, stripArticle, hasSpoiler,
  resolveModel, printModelRanking, chat, resolveEmbedModel, localEmbed, asString as str
} from '../lib/authoring_core.mjs';

const REPO = process.cwd();
const CONTENT_PATH = resolve(REPO, 'packs/lexicon_source/content.json');

const args = parseArgs(process.argv.slice(2));
const WISHLIST_PATH = resolve(REPO, args.wishlist ?? 'authoring/WISHLIST.jsonl');

async function main() {
  if (args.listModels) {
    await printModelRanking();
    return;
  }

  const wishlist = readWishlist(WISHLIST_PATH).slice(0, args.limit ?? Infinity);
  if (wishlist.length === 0) {
    console.log(`No entries in ${WISHLIST_PATH}.`);
    return;
  }
  const index = buildSurfaceIndex(CONTENT_PATH);

  let model = args.model ?? null;
  if (!args.dryRun) {
    model = await resolveModel(args.model); // throws helpfully if none / local LLM down
  }

  // Semantic match (optional, fail-safe): embed the concept corpus once (cached)
  // so we surface meaning-near candidates that exact surface match misses
  // (e.g. "geworfen" → the existing "werfen" concept).
  let conceptEmb = null;
  if (!args.dryRun && !args.noEmbed) {
    try {
      conceptEmb = await buildConceptEmbeddings(CONTENT_PATH);
    } catch (e) {
      console.warn(`  semantic match disabled (${e.message}); using exact-surface only.`);
    }
  }

  console.log(
    `Wishlist: ${wishlist.length} · content index: ${index.size} surface keys · ` +
      `model: ${model ?? 'auto (resolved at run)'}` +
      `${conceptEmb ? ` · embed: ${conceptEmb.embModel}` : ''} · host: ${LLM_HOST}` +
      `${args.dryRun ? ' · DRY RUN' : ''}\n`
  );

  const drafts = [];
  for (const [i, entry] of wishlist.entries()) {
    const candidates = await findCandidates(entry, index, conceptEmb);
    const prompt = buildPrompt(entry, candidates);
    const label = `[${i + 1}/${wishlist.length}] ${entry.term} (${entry.lang})`;

    if (args.dryRun) {
      console.log(`── ${label} ─────────────────────────────`);
      console.log(`candidates: ${candidates.length ? candidates.map((c) => c.summary).join(' | ') : 'none'}`);
      console.log(prompt.user, '\n');
      continue;
    }

    process.stdout.write(`${label} ... `);
    try {
      const record = await chat(prompt, model);
      record.wishlist_term = entry.term;
      record.wishlist_lang = entry.lang;
      record.model = model;
      record.existing_candidates = candidates.map((c) => c.concept_id);
      normalizeDraft(record);
      record.issues = validateDraft(record);
      drafts.push(record);
      const m = record.match ?? {};
      const flag = record.issues.length ? ` ⚠ ${record.issues.length}` : '';
      console.log(`${m.kind ?? '?'}${m.confidence != null ? ` (${m.confidence})` : ''}${flag}`);
    } catch (err) {
      console.log(`ERROR: ${err?.message ?? err}`);
      drafts.push({ wishlist_term: entry.term, wishlist_lang: entry.lang, error: String(err?.message ?? err) });
    }
    if (args.delay && i < wishlist.length - 1) await sleep(args.delay);
  }

  if (args.dryRun) return;

  const flagged = drafts.filter((d) => d.issues?.length).length;
  const outDir = resolve(REPO, 'authoring/drafts');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `draft-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  writeFileSync(outPath, drafts.map((d) => JSON.stringify(d)).join('\n') + '\n', 'utf8');
  console.log(`\nWrote ${drafts.length} draft(s) (${flagged} flagged by guardrails) → ${outPath}`);
}

// ── semantic match (embeddings) ──────────────────────────────────────────────

/** One semantic text per concept: its de/it/en surfaces + the en/it gloss. */
function composeConceptTexts(data) {
  const lexByConcept = new Map();
  for (const lex of data.lexemes ?? []) {
    if (lex.is_active === false) continue;
    (lexByConcept.get(lex.concept_id) ?? lexByConcept.set(lex.concept_id, []).get(lex.concept_id)).push(lex);
  }
  const defByConcept = new Map();
  for (const d of data.concept_definitions ?? []) {
    const id = typeof d.concept_id === 'object' ? d.concept_id?.id : d.concept_id;
    if (!defByConcept.has(id)) defByConcept.set(id, {});
    if (d.short_definition) defByConcept.get(id)[d.lang] = d.short_definition;
  }
  const items = [];
  for (const c of data.concepts ?? []) {
    const lexes = lexByConcept.get(c.concept_id) ?? [];
    const byLang = (l) => lexes.find((x) => x.lang === l)?.text ?? '';
    const def = defByConcept.get(c.concept_id) ?? {};
    const label = LANGS.map(byLang).find(Boolean) || c.concept_id.slice(0, 8);
    const text = [...LANGS.map(byLang), ...LANGS.map((l) => def[l] ?? '')]
      .map((s) => String(s).trim())
      .filter(Boolean)
      .join(' · ');
    if (text) items.push({ concept_id: c.concept_id, label, text: `${c.pos ?? ''} ${text}`.trim() });
  }
  return items;
}

async function buildConceptEmbeddings(contentPath) {
  const data = JSON.parse(readFileSync(contentPath, 'utf8'));
  const items = composeConceptTexts(data);
  const embModel = await resolveEmbedModel(args.embedModel);
  const cacheDir = resolve(REPO, 'authoring/.cache');
  // Per-concept cache keyed by each concept's text hash (not the whole-file hash), so
  // adding/changing one word only embeds that one concept instead of re-embedding all
  // of them. The cache file holds { embModel, vecs: { <textHash>: vector } }.
  const cachePath = resolve(cacheDir, `concept-emb-${embModel.replace(/[^a-z0-9]/gi, '_')}.json`);
  let cachedVecs = {};
  if (existsSync(cachePath)) {
    try {
      const prev = JSON.parse(readFileSync(cachePath, 'utf8'));
      if (prev.embModel === embModel && prev.vecs) cachedVecs = prev.vecs;
    } catch { /* corrupt cache: rebuild from scratch */ }
  }
  const textHash = (t) => createHash('md5').update(t).digest('hex').slice(0, 16);
  const withHash = items.map((it) => ({ ...it, th: textHash(it.text) }));
  const missing = withHash.filter((it) => !cachedVecs[it.th]);
  if (missing.length === 0) {
    console.log(`Embedding cache hit: ${items.length} concepts (${embModel}).`);
  } else {
    const reused = items.length - missing.length;
    console.log(`Embedding ${missing.length} new/changed of ${items.length} concepts with ${embModel}${reused ? ` (reusing ${reused} cached)` : ' (first run)'}...`);
    const vectors = await embedBatched(missing.map((i) => i.text), embModel);
    missing.forEach((it, i) => { cachedVecs[it.th] = vectors[i]; });
  }
  // Persist only the vectors for the current concepts so the cache stays bounded.
  const vecs = {};
  for (const it of withHash) vecs[it.th] = cachedVecs[it.th];
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cachePath, JSON.stringify({ embModel, vecs }));
  return { embModel, items: withHash.map((it) => ({ concept_id: it.concept_id, label: it.label, vec: cachedVecs[it.th] })) };
}

async function embedBatched(texts, model, batch = 64) {
  const out = [];
  for (let i = 0; i < texts.length; i += batch) {
    out.push(...(await localEmbed(texts.slice(i, i + batch), model)));
    process.stdout.write(`\r  embedded ${Math.min(i + batch, texts.length)}/${texts.length}`);
  }
  process.stdout.write('\n');
  return out;
}

async function semanticCandidates(entry, conceptEmb, k) {
  const query = `${entry.term}${entry.hint ? ` - ${entry.hint}` : ''}`;
  const [qvec] = await localEmbed([query], conceptEmb.embModel);
  const scored = conceptEmb.items
    .map((it) => ({ concept_id: it.concept_id, label: it.label, score: cosine(qvec, it.vec) }))
    .sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score >= (args.embedMin ?? 0.55)).slice(0, k);
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// ── wishlist + content ───────────────────────────────────────────────────────

function readWishlist(path) {
  if (!existsSync(path)) throw new Error(`Wishlist not found: ${path}`);
  const out = [];
  for (const [n, raw] of readFileSync(path, 'utf8').split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      console.warn(`  skipping bad JSONL line ${n + 1}: ${line}`);
      continue;
    }
    if (!obj.term || !obj.lang) {
      console.warn(`  skipping line ${n + 1} (needs term + lang): ${line}`);
      continue;
    }
    out.push({ term: String(obj.term).trim(), lang: String(obj.lang).trim().toLowerCase(), hint: obj.hint ?? null });
  }
  return out;
}

function buildSurfaceIndex(contentPath) {
  const data = JSON.parse(readFileSync(contentPath, 'utf8'));
  const conceptPos = new Map((data.concepts ?? []).map((c) => [c.concept_id, c.pos]));
  const index = new Map();
  for (const lex of data.lexemes ?? []) {
    if (lex.is_active === false) continue;
    const pos = lex.pos ?? conceptPos.get(lex.concept_id) ?? null;
    for (const surface of [lex.lemma, lex.text]) {
      const key = surfaceKey(lex.lang, surface);
      if (!key) continue;
      const bucket = index.get(key) ?? [];
      bucket.push({ concept_id: lex.concept_id, lang: lex.lang, text: lex.text, pos });
      index.set(key, bucket);
    }
  }
  return index;
}

async function findCandidates(entry, index, conceptEmb) {
  const key = surfaceKey(entry.lang, entry.term);
  const hits = key ? index.get(key) ?? [] : [];
  const seen = new Set();
  const out = [];
  for (const hit of hits) {
    if (seen.has(hit.concept_id)) continue;
    seen.add(hit.concept_id);
    out.push({ ...hit, source: 'exact', summary: `${hit.concept_id.slice(0, 8)} ${hit.text} [${hit.pos ?? '?'}] (exact)` });
  }
  if (conceptEmb) {
    try {
      for (const n of await semanticCandidates(entry, conceptEmb, args.embedTop ?? 5)) {
        if (seen.has(n.concept_id)) continue;
        seen.add(n.concept_id);
        out.push({ concept_id: n.concept_id, text: n.label, pos: '?', source: 'semantic', summary: `${n.concept_id.slice(0, 8)} ${n.label} (~${n.score.toFixed(2)})` });
      }
    } catch {
      /* fail-safe: keep exact candidates */
    }
  }
  return out;
}

// ── normalization ────────────────────────────────────────────────────────────

function surfaceKey(lang, raw) {
  const stripped = stripArticle(normalizeSearch(raw));
  return stripped ? `${String(lang).toLowerCase()}|${stripped}` : null;
}

// ── prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(entry, candidates) {
  const system = [
    `You are a meticulous multilingual (${langList()}) lexicographer building a concept graph for a multilingual vocabulary learning app. Output STRICT JSON only - no prose, no markdown.`,
    '',
    `A CONCEPT is ONE language-neutral meaning. LEXEMES are its words in ${LANGS.join('/')}.`,
    '',
    'HARD RULES:',
    '1. `text` = the full dictionary citation form. For NOUNS include the definite article: de "der Apfel", it "la mela", en "the apple". For other words, just the word: de "laufen", en "run". The German article MUST match the noun\'s real gender ("der Apfel" is masculine - NEVER "die Apfel"); set `gender` (m/f/n) to that same gender.',
    '2. `lemma` = the base form WITHOUT any article: "Apfel", "mela", "apple", "laufen", "run". NEVER put only an article in `text`. NEVER leave `text` empty.',
    '3. If the input term is an INFLECTED form (e.g. "geworfen", "gelaufen", a plural, a conjugation), resolve the CONCEPT to its lemma (e.g. "werfen") and use the lemma citation form in `text`. But do NOT strip separable/inseparable verb prefixes: "herausfinden" stays "herausfinden" (NEVER "finden"), "aufstehen" stays "aufstehen" (NEVER "stehen") - a prefixed verb is its OWN concept.',
    `4. Provide all active languages (${LANGS.join(', ')}), each the single most natural translation. English verbs: base form ONLY - NEVER prefix with "to", no underscores ("run", "find out" - NEVER "to run" / "find_out").`,
    '5. `synonyms` / `antonyms`: per language ({de,it,en}), other lexemes IN THAT SAME LANGUAGE (different words), in citation form - e.g. synonyms for "glad": en ["happy","pleased"], de ["froh","zufrieden"], it ["contento","felice"]. Each language\'s list holds ONLY that language\'s words. A list MUST NOT include that language\'s own headword or any inflection of it. [] for a language with none (never guess - empty beats wrong).',
    '6. SPOILERS. A DEFINITION must NOT contain the headword, any inflection of it (e.g. a definition of "herausfinden" must not contain "herausfinden"/"herausgefunden"), or its translation in another language - describe the meaning with OTHER words, keep it short. An EXAMPLE is a natural sentence in its OWN language: PREFER one that does not use the headword, but using the word naturally is acceptable (the app masks it for the guessing game). An example must NEVER contain the translation in another language.',
    '6b. BETTER EMPTY THAN WRONG. If you cannot write a SHORT, ACCURATE, spoiler-free definition or example for a language - or you are unsure of a translation/synonym - leave that field EMPTY ("" or []). Never guess, never write filler or vague meta-text like "a word that expresses...". An empty field is fine; a wrong or spoiler one is not.',
    '7. On an "attach" match, the translations/definitions MUST describe the EXISTING concept\'s meaning - do not drift to a different word.',
    '8. `match.kind`: "duplicate" (same meaning already present), "attach" (this lexeme belongs on a candidate concept), "ambiguous" (several plausible concepts), "new" (none fit). Give concept_id (or null), confidence 0..1, one-line reason. Never claim a match you are unsure of.',
    '',
    'WORKED EXAMPLE (term "der Apfel"):',
    JSON.stringify(EXAMPLE, null, 0)
  ].join('\n');

  const candidateText = candidates.length
    ? candidates.map((c) => `- ${c.concept_id} :: ${c.text} [${c.pos ?? '?'}, ${c.lang}]`).join('\n')
    : '(none found by exact surface match)';

  const user = [
    `TERM: ${entry.term}`,
    `INPUT LANGUAGE: ${entry.lang}`,
    entry.hint ? `SENSE HINT: ${entry.hint}` : 'SENSE HINT: (none)',
    '',
    'EXISTING CANDIDATE CONCEPTS (same surface):',
    candidateText,
    '',
    'Return JSON with EXACTLY this shape:',
    JSON.stringify(SHAPE, null, 0)
  ].join('\n');

  return { system, user };
}

const SHAPE = {
  match: { kind: 'new|attach|ambiguous|duplicate', concept_id: null, confidence: 0.0, reason: '' },
  concept: { pos: '', level: 'A1', gender: 'none', domain_tags: [] },
  lexemes: Object.fromEntries(LANGS.map((l) => [l, { text: '', lemma: '' }])),
  definitions: Object.fromEntries(LANGS.map((l) => [l, ''])),
  synonyms: Object.fromEntries(LANGS.map((l) => [l, []])),
  antonyms: Object.fromEntries(LANGS.map((l) => [l, []])),
  example: Object.fromEntries(LANGS.map((l) => [l, '']))
};

const EXAMPLE = {
  match: { kind: 'new', concept_id: null, confidence: 1, reason: 'No existing apple-fruit concept.' },
  concept: { pos: 'noun', level: 'A1', gender: 'm', domain_tags: ['food'] },
  lexemes: { de: { text: 'der Apfel', lemma: 'Apfel' }, it: { text: 'la mela', lemma: 'mela' }, en: { text: 'the apple', lemma: 'apple' } },
  definitions: { de: 'Eine runde, knackige Frucht, oft rot oder grün.', it: 'Frutto tondo e croccante, spesso rosso o verde.', en: 'A round, crisp fruit, often red or green.' },
  synonyms: { de: [], it: [], en: [] },
  antonyms: { de: [], it: [], en: [] },
  example: { de: 'Ich esse jeden Morgen so eine Frucht.', it: 'Mangio uno di questi frutti ogni mattina.', en: 'I eat one of these every morning.' }
};

// ── guardrails ───────────────────────────────────────────────────────────────

/** Safe, mechanical normalization of AI output (no meaning change). Fixes the
 *  trivial things automatically so the guardrails only flag real judgement calls. */
function normalizeDraft(r) {
  for (const lang of LANGS) {
    const lex = r.lexemes?.[lang];
    if (!lex) continue;
    if (typeof lex.lemma === 'string') lex.lemma = lex.lemma.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    if (typeof lex.text === 'string') lex.text = lex.text.replace(/\s+/g, ' ').trim();
  }
  // English: drop the infinitive marker "to " from text + lemma.
  const en = r.lexemes?.en;
  for (const k of ['text', 'lemma']) {
    if (en && typeof en[k] === 'string') en[k] = en[k].replace(/^to\s+/i, '').trim();
  }
  // Language-specific concept inference (e.g. German gender from der/die/das) via plugins.
  for (const lang of LANGS) getAuthoringPlugin(lang)?.inferConcept?.(r);
  // Drop each language's own headword (text or lemma) from its synonyms/antonyms; trim + dedup.
  for (const field of ['synonyms', 'antonyms']) {
    if (!r[field] || typeof r[field] !== 'object') continue;
    for (const lang of LANGS) {
      if (!Array.isArray(r[field][lang])) continue;
      const heads = new Set(
        [
          normalizeSearch(stripArticle(normalizeSearch(r.lexemes?.[lang]?.text ?? ''))),
          normalizeSearch(r.lexemes?.[lang]?.lemma ?? '')
        ].filter(Boolean)
      );
      const seen = new Set();
      r[field][lang] = r[field][lang]
        .map((w) => String(w).trim())
        .filter(Boolean)
        .filter((w) => !/[^\p{Script=Latin}\p{P}\s\d]/u.test(w)) // drop corrupted/mojibake entries
        .filter((w) => !heads.has(normalizeSearch(stripArticle(normalizeSearch(w)))))
        .filter((w) => (seen.has(w.toLowerCase()) ? false : seen.add(w.toLowerCase())));
    }
  }
  // A valid attach/duplicate id = one of the concepts we actually surfaced. Ids
  // are a MIX of UUIDs and readable "concept-..." slugs, so never pattern-match -
  // membership in existing_candidates is the only authoritative check.
  const kind = r.match?.kind;
  if (r.match && (kind === 'attach' || kind === 'duplicate')) {
    const cid = r.match.concept_id;
    const candidates = r.existing_candidates ?? [];
    if (cid == null || !candidates.includes(cid)) {
      if (candidates.length === 0) {
        r.match.kind = 'new'; // nothing real to attach to → it's a new concept
        r.match.concept_id = null;
        r.match.reason = `[auto: no real candidate → new] ${r.match.reason ?? ''}`.trim();
      } else if (candidates.length === 1) {
        r.match.concept_id = candidates[0]; // fumbled id, one real candidate → use it
        r.match.reason = `[auto: id → ${candidates[0]}] ${r.match.reason ?? ''}`.trim();
      } else {
        r.match.concept_id = null; // several candidates, none picked → leave for a human
      }
    }
  }

  // Spoiler scrub (empty beats wrong): blank any definition that names the word
  // it defines (or an inflection), and any definition/example that leaks another
  // language's answer surface. Blanked fields are simply left empty.
  const surf = {};
  for (const l of LANGS) {
    const lx = r.lexemes?.[l] ?? {};
    surf[l] = [normalizeSearch(stripArticle(normalizeSearch(lx.text ?? ''))), normalizeSearch(lx.lemma ?? '')].filter(Boolean);
  }
  for (const l of LANGS) {
    const others = LANGS.filter((x) => x !== l).flatMap((x) => surf[x]);
    if (r.definitions && hasSpoiler(r.definitions[l], surf[l], others)) r.definitions[l] = '';
    if (r.example && hasSpoiler(r.example[l], [], others)) r.example[l] = '';
  }
  return r;
}

function validateDraft(r) {
  const issues = [];
  const kind = r.match?.kind;
  if (!['new', 'attach', 'ambiguous', 'duplicate'].includes(kind)) issues.push(`match.kind invalid: ${kind}`);

  // attach/duplicate must reference a concept we actually surfaced (ids are a mix
  // of UUIDs + readable "concept-..." slugs, so check membership, not a pattern).
  if (kind === 'attach' || kind === 'duplicate') {
    const cid = r.match?.concept_id;
    if (cid == null) issues.push(`${kind} without concept_id`);
    else if (!(r.existing_candidates ?? []).includes(cid)) issues.push(`${kind} to a concept_id not among the surfaced candidates (${cid})`);
  }

  for (const lang of LANGS) {
    const lex = r.lexemes?.[lang];
    const text = str(lex?.text).trim();
    if (!text) issues.push(`${lang}.text empty`);
    else if (ARTICLES_BY_LANG[lang].includes(normalizeSearch(text))) issues.push(`${lang}.text is just an article ("${text}")`);
    if (!str(lex?.lemma).trim()) issues.push(`${lang}.lemma empty`);
    if (/_/.test(lex?.lemma ?? '')) issues.push(`${lang}.lemma has underscore`);
  }
  if (/^to\s+\S/.test(str(r.lexemes?.en?.text).trim().toLowerCase())) {
    issues.push(`en.text starts with "to" ("${r.lexemes.en.text}")`);
  }

  // Language-specific validation (e.g. German gender must agree with der/die/das) via plugins.
  for (const lang of LANGS) issues.push(...(getAuthoringPlugin(lang)?.validate?.(r) ?? []));

  // Flag obviously corrupted synonyms/antonyms (non-Latin / control chars), and any
  // language's list containing that language's own headword (text OR lemma) or an inflection.
  for (const field of ['synonyms', 'antonyms']) {
    for (const lang of LANGS) {
      const list = r[field]?.[lang] ?? [];
      const heads = new Set(
        [
          normalizeSearch(stripArticle(normalizeSearch(r.lexemes?.[lang]?.text ?? ''))),
          normalizeSearch(r.lexemes?.[lang]?.lemma ?? '')
        ].filter(Boolean)
      );
      for (const w of list) {
        if (/[^\p{Script=Latin}\p{P}\s\d]/u.test(String(w))) issues.push(`${field}.${lang} has a corrupted entry ("${w}")`);
        if (heads.has(normalizeSearch(stripArticle(normalizeSearch(w))))) issues.push(`${field}.${lang} contains the headword ("${w}")`);
      }
    }
  }
  // Empty definitions/examples are ACCEPTABLE (better empty than wrong) - the
  // model leaves them blank when unsure and the spoiler scrub blanks bad ones.
  // They're filled later in review. Only the word itself (text/lemma) is required.
  return issues;
}

// ── args ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { dryRun: false, listModels: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--list-models') out.listModels = true;
    else if (a === '--model') out.model = argv[++i];
    else if (a === '--wishlist') out.wishlist = argv[++i];
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--delay') out.delay = Number(argv[++i]);
    else if (a === '--no-embed') out.noEmbed = true;
    else if (a === '--embed-model') out.embedModel = argv[++i];
    else if (a === '--embed-top') out.embedTop = Number(argv[++i]);
    else if (a === '--embed-min') out.embedMin = Number(argv[++i]);
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

main().catch((err) => {
  console.error('FATAL:', err?.message ?? err);
  process.exit(1);
});
