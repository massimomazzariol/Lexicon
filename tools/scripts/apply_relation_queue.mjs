// Apply human decisions from the relation review queue (MT-C5, bucket a2).
//
// Workflow: `interconnect.mjs --queue-out authoring/relation_queue.json` writes
// the queue; a human edits entries adding a "decision" field; this tool turns
// decided entries into `source: "manual"` edges (never touched by --apply).
//
//   "decision": "synonym" | "antonym" | "related"   -> edge of that type
//   "decision": "reject"                            -> recorded in the report only
//   no "decision" field                             -> skipped (still pending)
//
// Every written edge passes the same invariants as the writer: one relation
// per pair, and the level-adjacency rule (a wide-span decision is refused -
// fix the concept level first, that is the rule's job).
//
//   node tools/scripts/apply_relation_queue.mjs --queue authoring/relation_queue.json          # preview
//   node tools/scripts/apply_relation_queue.mjs --queue authoring/relation_queue.json --apply  # write

import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  RELATION_TYPES,
  relationId,
  normalizePair,
  pairKey,
  levelSpan,
  MAX_LEVEL_SPAN,
  DEFAULT_TIER,
  sortEdges,
} from '../lib/concept_relations.mjs';
import { writeJsonAtomic, withContentLock } from '../lib/content_store.mjs';

const CONTENT = resolve(process.cwd(), 'packs/lexicon_source/content.json');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const queueIdx = args.indexOf('--queue');
if (queueIdx === -1 || !args[queueIdx + 1]) {
  console.error('Usage: node tools/scripts/apply_relation_queue.mjs --queue <file> [--apply]');
  process.exit(1);
}
const queuePath = resolve(process.cwd(), args[queueIdx + 1]);

const queue = JSON.parse(readFileSync(queuePath, 'utf8'));
const entries = [
  ...(queue.one_sided ?? []),
  ...(queue.wide_span ?? []),
  ...(queue.conflicts ?? []),
];

const decided = entries.filter((e) => typeof e.decision === 'string');
if (decided.length === 0) {
  console.log(`No decided entries in ${args[queueIdx + 1]} (add "decision": "synonym" | "antonym" | "related" | "reject").`);
  process.exit(0);
}

const data = JSON.parse(readFileSync(CONTENT, 'utf8'));
const conceptById = new Map((data.concepts ?? []).map((c) => [c.concept_id, c]));
const covered = new Set((data.concept_relations ?? []).map((e) => pairKey(e.concept_a, e.concept_b)));

const toWrite = [];
const rejected = [];
const refused = [];
for (const entry of decided) {
  const decision = entry.decision.toLowerCase();
  const [a, b] = normalizePair(entry.concept_a, entry.concept_b);
  if (decision === 'reject') {
    rejected.push(entry);
    continue;
  }
  if (!RELATION_TYPES.includes(decision)) {
    refused.push([entry, `unknown decision "${entry.decision}"`]);
    continue;
  }
  if (covered.has(pairKey(a, b))) {
    refused.push([entry, 'pair already has an edge (one relation per pair)']);
    continue;
  }
  const span = levelSpan(conceptById.get(a), conceptById.get(b));
  if (span === null || span > MAX_LEVEL_SPAN) {
    refused.push([entry, `level span ${span ?? 'unknown'} exceeds ${MAX_LEVEL_SPAN} - fix the concept level first`]);
    continue;
  }
  covered.add(pairKey(a, b));
  toWrite.push({
    relation_id: relationId(decision, a, b),
    relation_type: decision,
    concept_a: a,
    concept_b: b,
    ...(decision === 'synonym' ? { tier: entry.tier ?? DEFAULT_TIER } : {}),
    lang_scope_json: Array.isArray(entry.langs) && entry.langs.length ? entry.langs : null,
    source: 'manual',
  });
}

console.log(`Decided: ${decided.length} · to write: ${toWrite.length} · rejected: ${rejected.length} · refused: ${refused.length}`);
for (const [entry, why] of refused) {
  console.log(`  REFUSED ${entry.concept_a} <-> ${entry.concept_b}: ${why}`);
}

if (!apply) {
  console.log('\nPreview only. Re-run with --apply to write the manual edges.');
  process.exit(0);
}

withContentLock(CONTENT, () => {
  const content = JSON.parse(readFileSync(CONTENT, 'utf8'));
  content.concept_relations = sortEdges([...(content.concept_relations ?? []), ...toWrite]);
  writeJsonAtomic(CONTENT, content);
  console.log(`\nWrote ${toWrite.length} manual edge(s). Review: git diff packs/lexicon_source/content.json`);
}, { tool: 'apply_relation_queue' });
