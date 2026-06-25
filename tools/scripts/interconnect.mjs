// Interconnection - turn textual synonyms/antonyms into real links + sense clusters.
// DETERMINISTIC (exact string matching, no model - zero hallucination) - EPIC-ED-01.
//
// Synonyms/antonyms live as free text on each definition. This resolves each one to an
// existing concept (exact match on lemma/surface, per language), builds per-language
// synonym CLUSTERS (connected components = sense families), and reports:
//   - dangling synonyms  → a word referenced but NOT in the lexicon = a word to add & connect
//   - ambiguous synonyms → the word maps to >1 sense (needs a human hint), skipped (safe)
//   - isolated concepts  → no synonym link at all
// Read-only by default; --apply (re)builds the synonym clusters (idempotent). Never commits.
//
//   node tools/scripts/interconnect.mjs            # report only
//   node tools/scripts/interconnect.mjs --apply     # also (re)build synonym clusters

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { createHash } from 'crypto';
import { normalizeSearch, stripArticle } from '../lib/authoring_core.mjs';

const CONTENT = resolve(process.cwd(), 'packs/lexicon_source/content.json');
const LANGS = ['de', 'it', 'en'];
const args = parseArgs(process.argv.slice(2));

main();

function main() {
  const data = JSON.parse(readFileSync(CONTENT, 'utf8'));
  const cidOf = (x) => (x && typeof x === 'object' ? x.id : x);
  const lexemes = data.lexemes || [];
  const concepts = data.concepts || [];

  // Per-language surface → Set(concept_id), and each concept's primary lexeme per language.
  const index = { de: new Map(), it: new Map(), en: new Map() };
  const primaryLex = { de: new Map(), it: new Map(), en: new Map() };
  for (const lx of lexemes) {
    const l = String(lx.lang).toLowerCase();
    if (!index[l]) continue;
    for (const k of [key(lx.text), key(lx.lemma)]) if (k) (index[l].get(k) ?? index[l].set(k, new Set()).get(k)).add(lx.concept_id);
    if (lx.is_primary || !primaryLex[l].has(lx.concept_id)) primaryLex[l].set(lx.concept_id, lx.lexeme_id);
  }

  const synEdges = { de: [], it: [], en: [] };
  let resolved = 0, dangling = 0, ambiguous = 0, selfref = 0, antResolved = 0, antDangling = 0;
  const danglingSamples = [], ambiguousSamples = [];
  const danglingWords = new Map(); // lang\tkey → { term, lang } : words referenced but missing

  for (const d of data.concept_definitions || []) {
    const L = String(d.lang).toLowerCase();
    if (!index[L]) continue;
    const C = cidOf(d.concept_id);
    const handle = (list, isAnt) => {
      for (const w of list || []) {
        const k = key(w);
        if (!k) continue;
        const tg = index[L].get(k);
        if (!tg) {
          danglingWords.set(`${L}\t${k}`, { term: String(w).trim(), lang: L });
          if (isAnt) antDangling++; else { dangling++; if (danglingSamples.length < 15) danglingSamples.push(`${L}: "${w}"`); }
          continue;
        }
        const others = [...tg].filter((x) => x !== C);
        if (others.length === 0) { selfref++; continue; }
        if (others.length > 1) { if (!isAnt) { ambiguous++; if (ambiguousSamples.length < 10) ambiguousSamples.push(`${L}: "${w}" → ${others.length} senses`); } continue; }
        if (isAnt) antResolved++; else { resolved++; synEdges[L].push([C, others[0]]); }
      }
    };
    handle(d.synonyms_json, false);
    handle(d.antonyms_json, true);
  }

  // Per-language synonym clusters = connected components over the synonym edges.
  const newClusters = [], newMembers = [];
  const clustered = new Set();
  for (const L of LANGS) {
    for (const cids of components(synEdges[L])) {
      if (cids.length < 2) continue;
      const memberLex = cids.map((c) => primaryLex[L].get(c)).filter(Boolean);
      if (memberLex.length < 2) continue;
      const cid = uuidFrom(`syn:${L}:${[...cids].sort().join('|')}`);
      newClusters.push({ cluster_id: cid, lang: L, label: `synonyms: ${repLabel(cids, primaryLex[L], lexemes)}`, type: 'semantic', auto: true });
      memberLex.forEach((lid, i) => newMembers.push({ cluster_id: cid, lexeme_id: lid, position: i }));
      cids.forEach((c) => clustered.add(c));
    }
  }

  const linked = new Set();
  for (const L of LANGS) for (const [a, b] of synEdges[L]) { linked.add(a); linked.add(b); }
  const isolated = concepts.filter((c) => !linked.has(c.concept_id)).length;
  const handMade = (data.clusters || []).filter((c) => !c.auto).length;

  console.log(`Synonyms → links: ${resolved} resolved · ${ambiguous} ambiguous (multi-sense, skipped) · ${dangling} dangling (word not in lexicon) · ${selfref} self`);
  console.log(`Antonyms → links: ${antResolved} resolved · ${antDangling} dangling`);
  console.log(`Synonym clusters (sense families): ${newClusters.length} covering ${clustered.size} concept(s); hand-made clusters kept: ${handMade}`);
  console.log(`Isolated concepts (no synonym link): ${isolated}/${concepts.length} (${pct(isolated, concepts.length)})`);
  if (danglingSamples.length) { console.log('\nDangling synonyms - words referenced but missing (add & connect these):'); danglingSamples.forEach((s) => console.log('  - ' + s)); if (dangling > danglingSamples.length) console.log(`  ... +${dangling - danglingSamples.length} more`); }
  if (ambiguousSamples.length) { console.log('\nAmbiguous synonyms - resolve to >1 sense (need disambiguation):'); ambiguousSamples.forEach((s) => console.log('  - ' + s)); }

  // Optional: dump the dangling words as a ready wishlist (the words to add & connect next).
  if (args.danglingOut) {
    const out = resolve(process.cwd(), args.danglingOut);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, [...danglingWords.values()].map((d) => JSON.stringify(d)).join('\n') + '\n');
    console.log(`\nWrote ${danglingWords.size} dangling word(s) → ${args.danglingOut}  (feed to the drafter/populate to add & connect them).`);
  }

  if (!args.apply) { console.log('\nReport only. Re-run with --apply to (re)build synonym clusters; review the git diff.'); return; }

  // Idempotent: drop previously auto-generated clusters (+ members), add the fresh ones. Hand-made clusters untouched.
  const autoIds = new Set((data.clusters || []).filter((c) => c.auto).map((c) => c.cluster_id));
  data.clusters = (data.clusters || []).filter((c) => !c.auto).concat(newClusters);
  data.cluster_members = (data.cluster_members || []).filter((m) => !autoIds.has(m.cluster_id)).concat(newMembers);
  writeFileSync(CONTENT, JSON.stringify(data, null, 2) + '\n');
  console.log(`\nWrote ${newClusters.length} synonym clusters (${newMembers.length} members). Review: git diff packs/lexicon_source/content.json`);
}

function components(edges) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; }
    return r;
  };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const [a, b] of edges) union(a, b);
  const groups = new Map();
  for (const x of parent.keys()) { const r = find(x); (groups.get(r) ?? groups.set(r, []).get(r)).push(x); }
  return [...groups.values()];
}
function repLabel(cids, primMap, lexemes) {
  const lx = lexemes.find((l) => l.lexeme_id === primMap.get(cids[0]));
  return (lx?.text || cids[0]) + (cids.length > 2 ? ` +${cids.length - 1}` : '');
}
function uuidFrom(seed) { const h = createHash('sha1').update(seed).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; }
function key(s) { return stripArticle(normalizeSearch(s)); }
function pct(n, t) { return t ? Math.round((100 * n) / t) + '%' : '0%'; }
function parseArgs(argv) {
  const o = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') o.apply = true;
    else if (argv[i] === '--dangling-out') o.danglingOut = argv[++i];
  }
  return o;
}
