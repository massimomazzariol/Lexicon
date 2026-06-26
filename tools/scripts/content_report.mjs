// Content quality report (sampled) - VBR-160 / EPIC-ED-01.
// Read-only: never modifies content.json. Run anytime to track the core toward
// "100 common, complete, interconnected words per level".
//
//   node tools/scripts/content_report.mjs

import { readFileSync } from 'fs';
import { normalizeSearch, stripArticle, hasSpoiler } from '../lib/authoring_core.mjs';
import { LANGS } from '../lib/languages.mjs';

const d = JSON.parse(readFileSync('packs/lexicon_source/content.json', 'utf8'));
const concepts = d.concepts || [];
const lexemes = d.lexemes || [];
const defs = d.concept_definitions || [];
const examples = d.examples || [];
const clusters = d.clusters || [];
const members = d.cluster_members || [];

const cidOf = (x) => (x && typeof x === 'object' ? x.id : x);
const norm = normalizeSearch;
const strip = stripArticle;
const grp = (a, f) => { const m = new Map(); for (const x of a) { const k = f(x); (m.get(k) ?? m.set(k, []).get(k)).push(x); } return m; };
const lexBy = grp(lexemes, (l) => l.concept_id);
const defBy = grp(defs, (x) => cidOf(x.concept_id));
const exBy = grp(examples, (e) => cidOf(e.concept_id));

console.log(`TOTALS: ${concepts.length} concepts · ${lexemes.length} lexemes · ${defs.length} defs · ${examples.length} examples · ${clusters.length} clusters\n`);

const byLevel = {};
for (const c of concepts) { const L = c.level_override || c.level_auto || '?'; byLevel[L] = (byLevel[L] || 0) + 1; }
console.log('PER LEVEL (goal ≥100):');
for (const L of ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']) console.log(`  ${L}: ${byLevel[L] || 0}${(byLevel[L] || 0) < 100 ? `  (need +${100 - (byLevel[L] || 0)})` : ''}`);

let noEx = 0, noSyn = 0, noDef = 0, missLang = 0;
for (const c of concepts) {
  const langs = new Set((lexBy.get(c.concept_id) || []).map((l) => l.lang));
  if (!LANGS.every((l) => langs.has(l))) missLang++;
  const cdefs = defBy.get(c.concept_id) || [];
  if (cdefs.length === 0) noDef++;
  if ((exBy.get(c.concept_id) || []).length === 0) noEx++;
  if (cdefs.reduce((s, x) => s + (x.synonyms_json || []).length, 0) === 0) noSyn++;
}
const pct = (n) => `${Math.round((100 * n) / concepts.length)}%`;
console.log(`\nCOMPLETENESS: missing a language ${missLang} · no definition ${noDef} · no example ${noEx} (${pct(noEx)}) · no synonyms ${noSyn} (${pct(noSyn)})`);

// spoilers: a definition whose words prefix-match its own headword
let spoil = 0; const spoilSamples = [];
// cross-language leak in synonyms/antonyms (e.g. German antonyms on the Italian def)
let crossLeak = 0; const leakSamples = [];
for (const c of concepts) {
  const lx = lexBy.get(c.concept_id) || [];
  const surfByLang = {};
  for (const l of LANGS) surfByLang[l] = lx.filter((x) => x.lang === l).flatMap((x) => [strip(x.text), norm(x.lemma)]).filter((s) => s.length >= 3);
  for (const def of defBy.get(c.concept_id) || []) {
    if (hasSpoiler(def.short_definition, surfByLang[def.lang] || [], [])) {
      spoil++; if (spoilSamples.length < 6) spoilSamples.push(`${def.lang}: "${def.short_definition}"`);
    }
    // a syn/ant should be in the definition's own language; flag obvious other-lang words
    const others = LANGS.filter((l) => l !== def.lang).flatMap((l) => surfByLang[l] || []);
    const oset = new Set(others);
    for (const w of [...(def.synonyms_json || []), ...(def.antonyms_json || [])]) {
      if (oset.has(strip(w))) { crossLeak++; if (leakSamples.length < 6) leakSamples.push(`${def.lang} syn/ant "${w}" (other-language)`); break; }
    }
  }
}
console.log(`\nSPOILER definitions (name their own word): ${spoil}`);
spoilSamples.forEach((s) => console.log('  - ' + s));

console.log(`\nCROSS-LANGUAGE synonyms/antonyms (wrong-language words on a definition): ${crossLeak}`);
leakSamples.forEach((s) => console.log('  - ' + s));

// duplicate de-lemmas across concepts (separate likely true-dups from sense splits)
const deBy = grp(lexemes.filter((l) => l.lang === 'de'), (l) => strip(l.text));
const dups = [...deBy.entries()].map(([k, ls]) => [k, [...new Set(ls.map((l) => l.concept_id))]]).filter(([, ids]) => ids.length > 1);
const senseSplit = dups.filter(([, ids]) => ids.every((id) => /-[a-z]+$/.test(String(id)) && /(spitz|spitze|uberhaupt|ueberhaupt)/.test(String(id))));
console.log(`\nDUPLICATE de-lemmas on >1 concept: ${dups.length} (some are intentional sense splits; the rest are likely true duplicates to merge)`);
dups.slice(0, 12).forEach(([k, ids]) => console.log(`  - ${k} → ${ids.join(', ')}`));

const inCluster = new Set(members.map((m) => lexemes.find((l) => l.lexeme_id === m.lexeme_id)?.concept_id).filter(Boolean));
console.log(`\nINTERCONNECTION: ${inCluster.size}/${concepts.length} concepts in a cluster (${pct(inCluster.size)}) · ${clusters.length} clusters total`);
