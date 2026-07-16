// Shared decision-apply logic for the relation review queue (MT-C5 / UI-04c).
// One implementation behind both faces of the review workflow: the console
// flow (tools/lib/console/review_links.mjs) and the headless CLI
// (tools/scripts/apply_relation_queue.mjs).
//
// A queue file is what `interconnect.mjs --queue-out` writes: buckets of
// pairs that need a human (one_sided, wide_span, conflicts). A decision is a
// `decision` field on an entry: "synonym" | "antonym" | "related" | "reject".
// Decided entries become `source: "manual"` edges; the automatic writer never
// touches manual edges.

import { readFileSync } from 'fs';
import {
  RELATION_TYPES,
  relationId,
  normalizePair,
  pairKey,
  levelSpan,
  MAX_LEVEL_SPAN,
  DEFAULT_TIER,
  sortEdges,
} from './concept_relations.mjs';
import { writeJsonAtomic, withContentLock } from './content_store.mjs';

export const QUEUE_BUCKETS = Object.freeze(['one_sided', 'wide_span', 'conflicts']);

/** Flatten a queue file into one list, each entry tagged with its bucket. */
export function flattenQueue(queue) {
  return QUEUE_BUCKETS.flatMap((bucket) =>
    (queue?.[bucket] ?? []).map((entry) => ({ ...entry, bucket })));
}

/**
 * Turn decided entries into manual edges, enforcing the same invariants as
 * the automatic writer: one relation per pair, and the level-adjacency rule
 * (a wide-span decision is refused - fixing the concept level is the cure,
 * not overriding the rule). Pure function, no I/O. Entries without a
 * `decision` field are skipped (still pending).
 */
export function decideQueueEntries(entries, content) {
  const conceptById = new Map((content.concepts ?? []).map((c) => [c.concept_id, c]));
  const covered = new Set((content.concept_relations ?? []).map((e) => pairKey(e.concept_a, e.concept_b)));
  const toWrite = [];
  const rejected = [];
  const refused = [];
  for (const entry of entries) {
    if (typeof entry.decision !== 'string') continue;
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
  return { toWrite, rejected, refused };
}

/**
 * Append manual edges to the source pack, under the advisory lock, with a
 * fresh read inside the critical section so a concurrent writer is never
 * clobbered. Returns the number of edges written.
 */
export function writeManualEdges(contentPath, toWrite, { tool = 'relation_queue' } = {}) {
  if (!toWrite.length) return 0;
  withContentLock(contentPath, () => {
    const content = JSON.parse(readFileSync(contentPath, 'utf8'));
    content.concept_relations = sortEdges([...(content.concept_relations ?? []), ...toWrite]);
    writeJsonAtomic(contentPath, content);
  }, { tool });
  return toWrite.length;
}
