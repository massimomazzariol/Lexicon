// Shared core for the AI authoring tools (draft_from_wishlist, eval_fix, promote_drafts).
// Generic local-LLM integration + text utils + spoiler detection only - no
// content-shape or record-shape logic lives here.

import { langList } from './languages.mjs';

export const LLM_HOST = process.env.LLM_HOST ?? 'http://localhost:11434';

// Provenance written to committed records. We mark records as machine-generated, but NEVER
// the specific model - no AI/model name must ever land in git/GitHub. The model that did the
// work is an internal detail; if you need it for tuning it lives only in the local bandit
// cache (authoring/.cache, gitignored), never in content.json.
export const AI_PROVENANCE = 'ai';

export const ARTICLES_BY_LANG = {
  de: ['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine'],
  it: ['il', 'lo', 'la', 'i', 'gli', 'le', "l'", 'un', 'uno', 'una'],
  en: ['the', 'a', 'an', 'to']
};
export const ALL_ARTICLES = new Set(Object.values(ARTICLES_BY_LANG).flat());
export const DE_ARTICLE_GENDER = { der: 'm', die: 'f', das: 'n' };

// ── text ─────────────────────────────────────────────────────────────────────

export function normalizeSearch(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ß/g, 'ss')
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripArticle(normalized) {
  const parts = normalized.split(' ');
  if (parts.length > 1 && ALL_ARTICLES.has(parts[0])) return parts.slice(1).join(' ');
  return normalized;
}

/** Coerce a model/content field to a string before string ops: a model may emit a
 *  field as an array/object/number, where `x ?? ''` does NOT protect a later .trim()
 *  (the value isn't null, just the wrong type). Non-strings → '' (empty beats crash). */
export const asString = (v) => (typeof v === 'string' ? v : '');

/** True if `text` names the word it defines (own-language: the whole word or a
 *  short inflection of it - NOT a compound/derivative like Sonne→Sonnensystem),
 *  or leaks another language's answer (cross-language whole-word match). */
export function hasSpoiler(text, ownSurfaces, otherSurfaces) {
  if (!text || !String(text).trim()) return false;
  const toks = normalizeSearch(text).split(/[^a-z0-9']+/).filter(Boolean);
  for (const s of ownSurfaces) {
    if (s.length < 4) continue;
    // whole word, or the word + a short inflectional ending (≤2 chars: -s/-e/-n/-er...).
    // A long extra tail = a different compound/derivative, so it is NOT a spoiler.
    if (toks.some((t) => t === s || (t.startsWith(s) && t.length - s.length <= 2))) return true;
  }
  const tokSet = new Set(toks);
  for (const s of otherSurfaces) {
    if (s.length >= 3 && tokSet.has(s)) return true;
  }
  return false;
}

// ── local LLM: model selection ────────────────────────────────────────────────────

export async function listLocalModels() {
  let res;
  try {
    res = await fetch(`${LLM_HOST}/api/tags`);
  } catch {
    throw new Error(`Can't reach the local LLM server at ${LLM_HOST}. Is it running?`);
  }
  if (!res.ok) throw new Error(`local LLM /api/tags HTTP ${res.status}`);
  const body = await res.json();
  return body.models ?? [];
}

/** Ask the local LLM what a model can do (generic - capability-based, not name-based). */
async function modelCapabilities(name) {
  try {
    const res = await fetch(`${LLM_HOST}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: name })
    });
    if (!res.ok) return null;
    const body = await res.json();
    return Array.isArray(body.capabilities) ? body.capabilities : null;
  } catch {
    return null;
  }
}

const isEmbeddingOnly = (caps) => Array.isArray(caps) && caps.length > 0 && caps.every((c) => c === 'embedding');

/** Installed models that can generate text, largest first. Pure-embedding models
 *  are excluded by their reported capabilities (no model-name hardcoding). */
export async function listChatModels() {
  const models = await listLocalModels();
  const out = [];
  for (const m of models) {
    const name = m.name ?? m.model;
    if (isEmbeddingOnly(await modelCapabilities(name))) continue;
    out.push({ name, size: paramB(m.details?.parameter_size) ?? sizeFromName(name.toLowerCase()) ?? 0, sizeLabel: m.details?.parameter_size ?? sizeLabel(m) });
  }
  out.sort((a, b) => b.size - a.size);
  return out;
}

export async function resolveModel(requested) {
  const models = await listLocalModels();
  if (models.length === 0) throw new Error(`No models installed at ${LLM_HOST}. Pull one first.`);
  if (requested) {
    const hit = models.find((m) => (m.name ?? m.model) === requested || (m.name ?? '').startsWith(requested));
    if (hit) return hit.name ?? hit.model;
    throw new Error(`Model "${requested}" not installed. Available: ${models.map((m) => m.name ?? m.model).join(', ')}`);
  }
  const chat = await listChatModels();
  if (chat.length === 0) throw new Error('No text-generation models installed (only embedding models found).');
  console.log(`Auto-selected model: ${chat[0].name} (largest text model of ${chat.length}; override with --model).`);
  return chat[0].name;
}

export async function printModelRanking() {
  const all = await listLocalModels();
  const chat = await listChatModels();
  const chatNames = new Set(chat.map((m) => m.name));
  console.log(`Local LLM @ ${LLM_HOST} - ${all.length} model(s) installed.\n`);
  console.log('Text-generation models (largest first - size is the only generic signal;');
  console.log('actual quality on your task is decided by the judge, not a hardcoded ranking):');
  chat.forEach((m, i) => console.log(`  ${i === 0 ? '▶' : ' '} ${m.name}${m.sizeLabel ? `  [${m.sizeLabel}]` : ''}`));
  const excluded = all.map((m) => m.name ?? m.model).filter((n) => !chatNames.has(n));
  if (excluded.length) console.log(`\n  excluded (embedding-only): ${excluded.join(', ')}`);
}

function paramB(label) {
  const m = /([\d.]+)\s*b/i.exec(String(label ?? ''));
  return m ? Number(m[1]) : null;
}
function sizeFromName(name) {
  const m = /(\d+(?:\.\d+)?)b\b/.exec(name);
  return m ? Number(m[1]) : null;
}
function sizeLabel(m) {
  const s = paramB(m.details?.parameter_size) ?? sizeFromName((m.name ?? '').toLowerCase());
  return s ? `${s}B` : '';
}

// ── local LLM: chat + embeddings ──────────────────────────────────────────────────

export async function chat({ system, user }, model, { temperature = 0.2 } = {}) {
  const res = await fetch(`${LLM_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: 'json',
      options: { temperature },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  });
  if (!res.ok) throw new Error(`local LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  return parseModelJson(body?.message?.content ?? '');
}

/** Parse the model's JSON, salvaging near-misses (trailing padding / stray tokens
 *  around the object - a known format:json artifact) before giving up. */
export function parseModelJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    const a = content.indexOf('{');
    const b = content.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(content.slice(a, b + 1));
      } catch {
        /* fall through */
      }
    }
    return { parse_error: true, raw: content };
  }
}

/** Best-of-N judge: given a word and, per field, several labelled candidate values,
 *  ask a judge model to pick the best label (or "none" if all are wrong). Returns a
 *  { fieldPath: label } map. The judge is where wrong-language / gibberish / subtly
 *  wrong values get caught - things machine rules can't see. */
export async function judgeBestFields({ wordLine, fields }, judgeModel) {
  if (fields.length === 0) return {};
  const block = fields
    .map((f) => {
      const opts = Object.entries(f.options)
        .map(([k, v]) => `    ${k}) ${Array.isArray(v) ? JSON.stringify(v) : `"${v}"`}`)
        .join('\n');
      return `  ${f.path}:\n${opts}`;
    })
    .join('\n');
  const system =
    `You are a strict multilingual (${langList()}) lexicography judge. For each field you pick the LABEL of the single best candidate value, or "none" if every option is wrong. Output STRICT JSON only.`;
  const user = [
    `WORD: ${wordLine}`,
    '',
    'For each field below, choose the best label. Reject a value if ANY of these fail:',
    '(1) wrong meaning for the word; (2) WRONG LANGUAGE - a `de` field must be German, `it` Italian, `en` English, with NO foreign words; (3) it spoils the answer (contains the word being defined or its translation); (4) unnatural or gibberish; (5) synonyms/antonyms that are not real, same-language lexical alternatives.',
    '',
    'FIELDS:',
    block,
    '',
    'Return JSON mapping each field path to a chosen label or "none", e.g. {"definitions.de":"A","synonyms.it":"none"}.'
  ].join('\n');
  const res = await chat({ system, user }, judgeModel);
  return res && !res.parse_error ? res : {};
}

export async function resolveEmbedModel(requested) {
  const models = await listLocalModels();
  const names = models.map((m) => m.name ?? m.model);
  if (requested) {
    if (names.includes(requested) || names.some((n) => n.startsWith(requested))) return requested;
    throw new Error(`Embedding model "${requested}" not installed. Have: ${names.join(', ')}`);
  }
  // Prefer a model that reports the embedding capability (generic).
  for (const name of names) {
    const caps = await modelCapabilities(name);
    if (Array.isArray(caps) && caps.includes('embedding')) return name;
  }
  // Fallback for older servers without a capabilities field: a name hint.
  const hit = names.find((n) => /embed|bge|gte|nomic|minilm|mxbai/i.test(n));
  if (hit) return hit;
  throw new Error('No embedding model installed. Use --no-embed to skip.');
}

export async function localEmbed(input, model) {
  const res = await fetch(`${LLM_HOST}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, input })
  });
  if (!res.ok) throw new Error(`local LLM /api/embed HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const body = await res.json();
  const vecs = body?.embeddings ?? (body?.embedding ? [body.embedding] : null);
  if (!Array.isArray(vecs)) throw new Error('local LLM /api/embed returned no embeddings');
  return vecs;
}
