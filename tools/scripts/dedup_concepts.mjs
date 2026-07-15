// Dedup true duplicate concepts - EPIC-ED-01 / MT-C1.
//
// Finds concepts that are the SAME word AND the SAME meaning (same German lemma
// with overlapping en/it translation) and merges them, keeping the richer one and
// folding the other's examples + synonyms/antonyms in. INTENTIONAL sense-splits
// (same lemma, DIFFERENT translation - e.g. spitz-pointed vs spitz-cutting) and
// diacritic collisions (schon vs schön) are left alone.
//
//   node tools/scripts/dedup_concepts.mjs            # preview
//   node tools/scripts/dedup_concepts.mjs --apply    # merge, then review the git diff
//
// Never commits. The survivor of each merge is stamped review_status: needs_review.

import { readFileSync } from 'fs';
import { normalizeSearch, stripArticle } from '../lib/authoring_core.mjs';
import { rewriteEdgesForMerge } from '../lib/concept_relations.mjs';
import { writeJsonAtomic, withContentLock } from '../lib/content_store.mjs';
import { resolve } from 'path';

const CONTENT = resolve(process.cwd(), 'packs/lexicon_source/content.json');
const apply = process.argv.includes('--apply');

const data = JSON.parse(readFileSync(CONTENT, 'utf8'));
const concepts = data.concepts || [];
const lexemes = data.lexemes || [];
const defs = data.concept_definitions || [];
const examples = data.examples || [];
const members = data.cluster_members || [];

// Shared normalization (OVE-3): identical keys to the relation resolver, so
// what dedup merges and what interconnect resolves never diverge.
const norm = normalizeSearch;
const strip = (s) => stripArticle(normalizeSearch(s));
const cidOf = (x) => (x && typeof x === 'object' ? x.id : x);
const grp = (a, f) => { const m = new Map(); for (const x of a) { const k = f(x); (m.get(k) ?? m.set(k, []).get(k)).push(x); } return m; };

const lexByC = grp(lexemes, (l) => l.concept_id);
const defByC = grp(defs, (x) => cidOf(x.concept_id));
const exByC = grp(examples, (e) => cidOf(e.concept_id));
const conceptById = new Map(concepts.map((c) => [c.concept_id, c]));

const trans = (cid, lang) => (lexByC.get(cid) || []).filter((l) => l.lang === lang).map((l) => strip(l.text));
const richness = (cid) => {
  const ex = (exByC.get(cid) || []).length;
  const cdefs = defByC.get(cid) || [];
  const syn = cdefs.reduce((s, d) => s + (d.synonyms_json || []).length + (d.antonyms_json || []).length, 0);
  const df = cdefs.filter((d) => d.short_definition).length;
  return ex * 3 + syn + df;
};

// Group concepts that share a German lemma into same-MEANING clusters by
// translation overlap; clusters with >1 concept are true duplicates.
const byDe = grp(lexemes.filter((l) => l.lang === 'de'), (l) => strip(l.text));
const dupSets = [];
for (const [lemma, ls] of byDe) {
  const ids = [...new Set(ls.map((l) => l.concept_id))];
  if (ids.length < 2) continue;
  const groups = [];
  for (const id of ids) {
    const en = new Set(trans(id, 'en'));
    const it = new Set(trans(id, 'it'));
    const g = groups.find((grp) => grp.ids.some((o) => trans(o, 'en').some((x) => en.has(x)) || trans(o, 'it').some((x) => it.has(x))));
    if (g) g.ids.push(id);
    else groups.push({ ids: [id] });
  }
  for (const g of groups) if (g.ids.length > 1) dupSets.push({ lemma, ids: g.ids });
}

if (dupSets.length === 0) {
  console.log('No true duplicate concepts found.');
  process.exit(0);
}

const delConcepts = new Set();
const delLexemes = new Set();
const delDefs = new Set();
const delExamples = new Set();
const plan = [];

for (const set of dupSets) {
  const ranked = [...set.ids].sort((a, b) => richness(b) - richness(a));
  const primary = ranked[0];
  const others = ranked.slice(1);
  plan.push(`${set.lemma}: keep ${primary} (richness ${richness(primary)}), merge ${others.join(', ')}`);
  if (!apply) continue;

  conceptById.get(primary).review_status = 'needs_review';
  const pExSents = new Set((exByC.get(primary) || []).map((e) => norm(e.sentence)));
  for (const dup of others) {
    // examples: move unseen ones to primary, drop exact repeats
    for (const e of exByC.get(dup) || []) {
      if (pExSents.has(norm(e.sentence))) delExamples.add(e);
      else { e.concept_id = primary; pExSents.add(norm(e.sentence)); }
    }
    // definitions: fold syn/ant into primary's same-lang def; move a missing lang
    for (const dd of defByC.get(dup) || []) {
      const pd = (defByC.get(primary) || []).find((x) => x.lang === dd.lang);
      if (pd) {
        pd.synonyms_json = [...new Set([...(pd.synonyms_json || []), ...(dd.synonyms_json || [])])];
        pd.antonyms_json = [...new Set([...(pd.antonyms_json || []), ...(dd.antonyms_json || [])])];
        if (!pd.short_definition && dd.short_definition) pd.short_definition = dd.short_definition;
        delDefs.add(dd);
      } else {
        dd.concept_id = primary;
        (defByC.get(primary) || []).push(dd);
      }
    }
    // drop the duplicate's lexemes (the primary already has this word) + concept
    for (const l of lexByC.get(dup) || []) delLexemes.add(l);
    delConcepts.add(dup);
    // D8: retarget the duplicate's graph edges to the survivor (self-edges
    // dropped, duplicate pairs collapsed keeping the human-touched edge).
    rewriteEdgesForMerge(data, dup, primary);
  }
}

console.log(`Found ${dupSets.length} true-duplicate set(s):`);
plan.forEach((p) => console.log('  - ' + p));

if (!apply) {
  console.log('\nPreview only. Re-run with --apply to merge, then review the git diff.');
  process.exit(0);
}

const deadLexIds = new Set([...delLexemes].map((l) => l.lexeme_id));
data.concepts = concepts.filter((c) => !delConcepts.has(c.concept_id));
data.lexemes = lexemes.filter((l) => !delLexemes.has(l));
data.concept_definitions = defs.filter((d) => !delDefs.has(d));
data.examples = examples.filter((e) => !delExamples.has(e));
data.cluster_members = members.filter((m) => !deadLexIds.has(m.lexeme_id));

withContentLock(CONTENT, () => writeJsonAtomic(CONTENT, data), { tool: 'dedup_concepts' });
console.log(
  `\nMerged ${delConcepts.size} duplicate concept(s) (removed ${delLexemes.size} lexemes, ${delDefs.size} defs, ${delExamples.size} examples).` +
    '\nReview:  git diff packs/lexicon_source/content.json   then commit.'
);
