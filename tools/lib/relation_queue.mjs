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
 * Turn decided entries into manual edges, enforcing the same invariant as
 * the automatic writer: one relation per pair. (Level span stopped being a
 * write blocker on 2026-07-16 - it is an advisory signal now.)
 * Pure function, no I/O. Entries without a
 * `decision` field are skipped (still pending). `source` says WHO decided:
 * 'manual' for a human, 'ai' when a model made the call - honest provenance.
 */
export function decideQueueEntries(entries, content, { source = 'manual' } = {}) {
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
    covered.add(pairKey(a, b));
    toWrite.push({
      relation_id: relationId(decision, a, b),
      relation_type: decision,
      concept_a: a,
      concept_b: b,
      ...(decision === 'synonym' ? { tier: entry.tier ?? DEFAULT_TIER } : {}),
      lang_scope_json: Array.isArray(entry.langs) && entry.langs.length ? entry.langs : null,
      source,
    });
  }
  return { toWrite, rejected, refused };
}

/**
 * Persistent reject memory. A rejected pair writes no edge, so the analyzer
 * would resurface it on every queue regeneration; this data file remembers
 * the calls. `interconnect --queue-out` subtracts it from the queue.
 */
export const DEFAULT_REJECTS_REL = 'packs/lexicon_source/relation_rejects.json';

export function loadRejects(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { pairs: [] };
  }
}

export function appendRejects(path, entries, { decidedBy = 'human' } = {}) {
  const file = loadRejects(path);
  if (!Array.isArray(file.pairs)) file.pairs = [];
  const seen = new Set(file.pairs.map((p) => pairKey(p.concept_a, p.concept_b)));
  for (const e of entries) {
    const [a, b] = normalizePair(e.concept_a, e.concept_b);
    if (seen.has(pairKey(a, b))) continue;
    seen.add(pairKey(a, b));
    file.pairs.push({
      concept_a: a,
      concept_b: b,
      relation_type: e.relation_type ?? null,
      decided_by: decidedBy,
      rejected_at: new Date().toISOString().slice(0, 10),
    });
  }
  writeJsonAtomic(path, file);
  return file.pairs.length;
}

export function filterQueueByRejects(queue, rejects) {
  const rejectedPairs = new Set(
    (rejects?.pairs ?? []).map((p) => pairKey(p.concept_a, p.concept_b)));
  const out = { ...queue };
  for (const bucket of QUEUE_BUCKETS) {
    out[bucket] = (queue[bucket] ?? []).filter(
      (e) => !rejectedPairs.has(pairKey(e.concept_a, e.concept_b)));
  }
  return out;
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
