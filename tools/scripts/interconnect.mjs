// Interconnection CLI - the MT-C5 graph front door. Thin wrapper: all logic
// lives in tools/lib/concept_relations.mjs (see docs/planning/INTERCONNECTION_GRAPH.md).
//
// Report mode (default) triages every flat synonym/antonym string:
//   a1 mutual+adjacent pairs  -> ready to auto-write as concept_relations edges
//   a2 one-sided pairs        -> review queue (an undirected edge would assert
//                                a direction no editor wrote)
//   wide-span mutual pairs    -> review queue (adjacency rule: max 1 CEFR level;
//                                usually a wrong link or a mis-leveled concept)
//   conflicts / ambiguous     -> review queue
//   dangling words            -> wishlist (bucket c) + Q1 promotion-bar yield
//   phrases / self-references -> inventory (never edges)
//
// --apply (idempotent, locked, atomic):
//   - regenerates `source:"resolved"` edges (manual/ai edges never touched)
//   - rebuilds the DERIVED auto synonym clusters from the written edges (D6);
//     hand-made clusters are untouched
//
//   node tools/scripts/interconnect.mjs                    # report only
//   node tools/scripts/interconnect.mjs --apply            # write edges + clusters
//   node tools/scripts/interconnect.mjs --queue-out authoring/relation_queue.json
//   node tools/scripts/interconnect.mjs --dangling-out authoring/wishlist.jsonl
//   node tools/scripts/interconnect.mjs --phrases-out authoring/phrases.json

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { createHash } from 'crypto';
import {
  analyzeRelations,
  applyResolvedEdges,
  lintTransitiveContradictions,
  synonymComponents,
} from '../lib/concept_relations.mjs';
import { writeJsonAtomic, withContentLock } from '../lib/content_store.mjs';
import { filterQueueByRejects, loadRejects, DEFAULT_REJECTS_REL } from '../lib/relation_queue.mjs';
import { LANGS } from '../lib/languages.mjs';

const CONTENT = resolve(process.cwd(), 'packs/lexicon_source/content.json');
const args = parseArgs(process.argv.slice(2));

main();

function main() {
  const data = JSON.parse(readFileSync(CONTENT, 'utf8'));
  const res = analyzeRelations(data);
  const s = res.stats;

  const existingManual = (data.concept_relations ?? []).filter((e) => e.source !== 'resolved');
  const lintInput = [...existingManual, ...res.autoEdges];
  const contradictions = lintTransitiveContradictions(lintInput);

  console.log(`Flat references resolved: ${s.references} strings over ${s.pairs} concept pairs.`);
  console.log(`Auto edges (mutual + adjacent): ${s.autoEdges}`);
  const rejectsFile = loadRejects(resolve(process.cwd(), DEFAULT_REJECTS_REL));
  const reportQueue = filterQueueByRejects({
    one_sided: res.queue.oneSided,
    wide_span: res.queue.wideSpan,
    conflicts: res.queue.conflicts,
  }, rejectsFile);
  const remembered = (rejectsFile.pairs ?? []).length;
  console.log(`Review queue: ${reportQueue.one_sided.length} one-sided · ${reportQueue.conflicts.length} syn/ant conflicts · ${s.ambiguous} ambiguous` +
    (remembered ? ` · ${remembered} rejected pair(s) remembered` : ''));
  if (s.levelCheck) console.log(`Level check advised: ${s.levelCheck} written pair(s) span 2+ CEFR levels - one side may be mis-leveled`);
  console.log(`Dangling words (wishlist): ${s.dangling} (${s.promotionCandidates} pass the Q1 promotion bar: 2+ concepts or 2+ languages)`);
  console.log(`Phrases (answer-support only): ${s.phrases} · self-references: ${s.selfRef}`);

  const linked = new Set();
  for (const e of lintInput) { linked.add(e.concept_a); linked.add(e.concept_b); }
  const isolated = (data.concepts ?? []).filter((c) => !linked.has(c.concept_id)).length;
  const total = (data.concepts ?? []).length;
  console.log(`Isolated concepts (no edge at all): ${isolated}/${total} (${pct(isolated, total)})`);
  if (contradictions.length) {
    console.log(`\nTransitive contradictions (synonym chain that is also an antonym pair) - review:`);
    contradictions.slice(0, 10).forEach((c) => console.log('  - ' + c));
    if (contradictions.length > 10) console.log(`  ... +${contradictions.length - 10} more`);
  }

  if (args.queueOut) {
    const out = resolve(process.cwd(), args.queueOut);
    mkdirSync(dirname(out), { recursive: true });
    // Rejected pairs write no edge, so the analyzer keeps finding them in the
    // flat strings; the reject memory keeps them out of the human's queue.
    const filtered = reportQueue;
    writeJsonAtomic(out, {
      generated_at: new Date().toISOString(),
      ...filtered,
      ambiguous: res.queue.ambiguous,
    });
    const n = filtered.one_sided.length + filtered.wide_span.length + filtered.conflicts.length + s.ambiguous;
    console.log(`\nWrote review queue (${n} entries) -> ${args.queueOut}`);
  }
  if (args.danglingOut) {
    const out = resolve(process.cwd(), args.danglingOut);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, res.dangling.map((d) => JSON.stringify({ term: d.term, lang: d.lang })).join('\n') + '\n');
    console.log(`Wrote ${s.dangling} dangling word(s) -> ${args.danglingOut} (feed to the drafter/populate).`);
  }
  if (args.phrasesOut) {
    const out = resolve(process.cwd(), args.phrasesOut);
    mkdirSync(dirname(out), { recursive: true });
    writeJsonAtomic(out, res.phrases);
    console.log(`Wrote ${s.phrases} phrase(s) -> ${args.phrasesOut}`);
  }

  if (!args.apply) {
    console.log('\nReport only. Re-run with --apply to write resolved edges + derived clusters; review the git diff.');
    return;
  }

  withContentLock(CONTENT, () => {
    // Re-read inside the lock: another writer may have finished in between.
    const content = JSON.parse(readFileSync(CONTENT, 'utf8'));
    const fresh = analyzeRelations(content);
    const { written, skippedCovered } = applyResolvedEdges(content, fresh.autoEdges);
    rebuildDerivedClusters(content);
    writeJsonAtomic(CONTENT, content);
    console.log(`\nWrote ${written.length} resolved edge(s) (${skippedCovered.length} pair(s) skipped: already covered by a manual/ai edge).`);
    console.log(`Derived clusters rebuilt from synonym edges. Review: git diff packs/lexicon_source/content.json`);
  }, { tool: 'interconnect' });
}

// D6: auto semantic clusters are a VIEW over the synonym edges - per language,
// membership via each concept's primary lexeme. Same id recipe as before the
// MT-C5 rework so regenerations diff minimally. Hand-made clusters untouched.
function rebuildDerivedClusters(content) {
  const primaryLex = new Map(LANGS.map((l) => [l, new Map()]));
  for (const lx of content.lexemes ?? []) {
    const lang = String(lx.lang ?? '').toLowerCase();
    const byConcept = primaryLex.get(lang);
    if (!byConcept) continue;
    if (lx.is_primary || !byConcept.has(lx.concept_id)) byConcept.set(lx.concept_id, lx);
  }
  const components = synonymComponents(content.concept_relations ?? []);
  const newClusters = [];
  const newMembers = [];
  for (const lang of LANGS) {
    const byConcept = primaryLex.get(lang);
    for (const conceptIds of components) {
      const members = conceptIds.map((c) => byConcept.get(c)).filter(Boolean);
      if (members.length < 2) continue;
      const clusterId = uuidFrom(`syn:${lang}:${conceptIds.slice().sort().join('|')}`);
      const label = members[0].text + (conceptIds.length > 2 ? ` +${conceptIds.length - 1}` : '');
      newClusters.push({ cluster_id: clusterId, lang, label: `synonyms: ${label}`, type: 'semantic', auto: true });
      members.forEach((lx, i) => newMembers.push({ cluster_id: clusterId, lexeme_id: lx.lexeme_id, position: i }));
    }
  }
  const autoIds = new Set((content.clusters ?? []).filter((c) => c.auto).map((c) => c.cluster_id));
  content.clusters = (content.clusters ?? []).filter((c) => !c.auto).concat(newClusters);
  content.cluster_members = (content.cluster_members ?? []).filter((m) => !autoIds.has(m.cluster_id)).concat(newMembers);
}

function uuidFrom(seed) {
  const h = createHash('sha1').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
function pct(n, t) { return t ? Math.round((100 * n) / t) + '%' : '0%'; }
function parseArgs(argv) {
  const o = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') o.apply = true;
    else if (argv[i] === '--queue-out') o.queueOut = argv[++i];
    else if (argv[i] === '--dangling-out') o.danglingOut = argv[++i];
    else if (argv[i] === '--phrases-out') o.phrasesOut = argv[++i];
  }
  return o;
}
