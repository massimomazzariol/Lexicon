// Apply human decisions from the relation review queue (MT-C5, bucket a2).
// Headless twin of the console flow (lexicon menu: "Review word links");
// both run the same logic in tools/lib/relation_queue.mjs.
//
// Workflow: `interconnect.mjs --queue-out authoring/relation_queue.json` writes
// the queue; a human edits entries adding a "decision" field; this tool turns
// decided entries into `source: "manual"` edges (never touched by --apply).
//
//   "decision": "synonym" | "antonym" | "related"   -> edge of that type
//   "decision": "reject"                            -> recorded in the report only
//   no "decision" field                             -> skipped (still pending)
//
//   node tools/scripts/apply_relation_queue.mjs --queue authoring/relation_queue.json          # preview
//   node tools/scripts/apply_relation_queue.mjs --queue authoring/relation_queue.json --apply  # write

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { flattenQueue, decideQueueEntries, writeManualEdges, appendRejects, DEFAULT_REJECTS_REL } from '../lib/relation_queue.mjs';

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
const decided = flattenQueue(queue).filter((e) => typeof e.decision === 'string');
if (decided.length === 0) {
  console.log(`No decided entries in ${args[queueIdx + 1]} (add "decision": "synonym" | "antonym" | "related" | "reject").`);
  process.exit(0);
}

const data = JSON.parse(readFileSync(CONTENT, 'utf8'));
const { toWrite, rejected, refused } = decideQueueEntries(decided, data);

console.log(`Decided: ${decided.length} · to write: ${toWrite.length} · rejected: ${rejected.length} · refused: ${refused.length}`);
for (const [entry, why] of refused) {
  console.log(`  REFUSED ${entry.concept_a} <-> ${entry.concept_b}: ${why}`);
}

if (!apply) {
  console.log('\nPreview only. Re-run with --apply to write the manual edges.');
  process.exit(0);
}

writeManualEdges(CONTENT, toWrite, { tool: 'apply_relation_queue' });
if (rejected.length) {
  appendRejects(resolve(process.cwd(), DEFAULT_REJECTS_REL), rejected, { decidedBy: 'human' });
}
console.log(`\nWrote ${toWrite.length} manual edge(s), remembered ${rejected.length} reject(s). Review: git diff packs/lexicon_source/content.json`);
