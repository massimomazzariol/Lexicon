// concept_relations - the MT-C5 interconnection graph core.
//
// Turns the flat synonyms_json / antonyms_json strings on concept_definitions
// into first-class edges between concepts (`concept_relations[]` in the source
// content), applying the locked design rules (docs/planning/INTERCONNECTION_GRAPH.md):
//
// - An edge is UNDIRECTED (concept_a < concept_b) and asserts both directions,
//   so the writer auto-creates one ONLY when the pair is MUTUAL (each side's
//   flat strings resolve to the other) AND ADJACENT (endpoints at most one
//   CEFR level apart). Everything else goes to a human review queue.
// - A pair carries at most ONE relation type (synonym | antonym | related).
//   A pair resolving as both synonym and antonym is a conflict: no edge,
//   review queue.
// - lang_scope_json records exactly the languages with evidence, always as an
//   explicit array; null (= all languages, forever) is a manual-only assertion.
// - `--apply` regenerates ONLY `source: "resolved"` edges; manual/ai edges are
//   never touched, and a pair already covered by one is skipped.
//
// This module is pure logic (no I/O); tools/scripts/interconnect.mjs is the CLI.

import { createHash } from 'crypto';
import { normalizeSearch, stripArticle } from './authoring_core.mjs';
import { LANGS } from './languages.mjs';
import { LEXICON_LEVELS } from './lexicon_conventions.mjs';

export const RELATION_TYPES = Object.freeze(['synonym', 'antonym', 'related']);
export const RELATION_SOURCES = Object.freeze(['resolved', 'manual', 'ai']);
// Grading tiers, most conservative LAST (used by mergeTiers).
export const RELATION_TIERS = Object.freeze(['exact', 'close', 'loose']);
export const DEFAULT_TIER = 'close';
export const MAX_LEVEL_SPAN = 1; // ADVISORY threshold: a wider span often means a
// mis-leveled concept, so the report flags it - but it no longer blocks writes
// (user decision 2026-07-16: the dictionary records the language; level pacing
// is the consumer's job - a consumer loads only the packs it wants to serve).

const LEVEL_INDEX = new Map(LEXICON_LEVELS.map((level, i) => [level, i]));

export const surfaceKey = (s) => stripArticle(normalizeSearch(s));

/** Deterministic edge id - same sha1 recipe as interconnect's cluster ids. */
export function relationId(type, a, b) {
  const h = createHash('sha1').update(`rel:${type}:${a}|${b}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Undirected normalization: lexicographic order of the two concept ids. */
export function normalizePair(a, b) {
  return a < b ? [a, b] : [b, a];
}

export function pairKey(a, b) {
  const [x, y] = normalizePair(a, b);
  return `${x}|${y}`;
}

/** Most conservative tier wins (loose over close over exact); default close. */
export function mergeTiers(tiers) {
  let best = -1;
  for (const t of tiers ?? []) {
    const i = RELATION_TIERS.indexOf(t);
    if (i > best) best = i;
  }
  return best >= 0 ? RELATION_TIERS[best] : DEFAULT_TIER;
}

export function conceptLevel(concept) {
  return concept?.level_override || concept?.level_auto || null;
}

/** CEFR distance between two concepts; null when either level is unknown. */
export function levelSpan(conceptA, conceptB) {
  const a = LEVEL_INDEX.get(conceptLevel(conceptA));
  const b = LEVEL_INDEX.get(conceptLevel(conceptB));
  if (a === undefined || b === undefined) return null;
  return Math.abs(a - b);
}

const parseList = (v) => (Array.isArray(v) ? v : []);

/** Per-language surface -> Set(concept_id), from lexeme text and lemma. */
export function buildSurfaceIndex(content) {
  const index = new Map(LANGS.map((l) => [l, new Map()]));
  for (const lx of content.lexemes ?? []) {
    const lang = String(lx.lang ?? '').toLowerCase();
    const byKey = index.get(lang);
    if (!byKey) continue;
    for (const k of [surfaceKey(lx.text), surfaceKey(lx.lemma)]) {
      if (!k) continue;
      if (!byKey.has(k)) byKey.set(k, new Set());
      byKey.get(k).add(lx.concept_id);
    }
  }
  return index;
}

/**
 * Resolve every flat synonym/antonym string and triage it into the design's
 * buckets. Pure analysis - nothing is written.
 *
 * Returns {
 *   autoEdges,            // bucket a1: mutual AND adjacent -> ready to write
 *   queue: {              // needs a human decision before becoming an edge:
 *     oneSided,           //   a2: resolved, but only one side asserts it
 *     wideSpan,           //   mutual but spans 2+ CEFR levels (probable level error)
 *     conflicts,          //   same pair asserted as synonym AND antonym
 *     ambiguous,          //   b: string matches 2+ concepts (needs sense hint)
 *   },
 *   dangling,             // c: resolvable to no concept -> wishlist entries
 *   phrases,              // d: multi-word strings (never concepts)
 *   selfRef,              // e: string matches its own concept
 *   stats,
 * }
 */
export function analyzeRelations(content) {
  const index = buildSurfaceIndex(content);
  const conceptById = new Map((content.concepts ?? []).map((c) => [c.concept_id, c]));

  // pairKey -> { types: { synonym|antonym: { directions:Set, langs:Set, tiers:[] } } }
  const pairs = new Map();
  const ambiguous = [];
  const dangling = new Map(); // `${lang}\t${key}` -> { term, lang, from:Set(conceptId) }
  const phrases = [];
  const selfRef = [];
  let references = 0;

  for (const def of content.concept_definitions ?? []) {
    const lang = String(def.lang ?? '').toLowerCase();
    const byKey = index.get(lang);
    if (!byKey) continue;
    const origin = def.concept_id;
    const tiers = def.synonym_tiers_json && typeof def.synonym_tiers_json === 'object' ? def.synonym_tiers_json : {};

    const handle = (list, type) => {
      for (const raw of parseList(list)) {
        const term = String(raw ?? '').trim();
        const key = surfaceKey(term);
        if (!key) continue;
        references += 1;
        const targets = byKey.get(key);
        if (!targets) {
          // Unresolvable multi-word strings are answer-support phrases
          // (bucket d) - they can never become concepts. Multi-word strings
          // that DO resolve (real multi-word lexemes like "immer noch") are
          // normal pairs and fall through below.
          if (term.includes(' ')) {
            phrases.push({ term, lang, type, from: origin });
            continue;
          }
          const dkey = `${lang}\t${key}`;
          if (!dangling.has(dkey)) dangling.set(dkey, { term, lang, key, from: new Set() });
          dangling.get(dkey).from.add(origin);
          continue;
        }
        const others = [...targets].filter((id) => id !== origin);
        if (others.length === 0) {
          selfRef.push({ term, lang, type, from: origin });
          continue;
        }
        if (others.length > 1) {
          ambiguous.push({ term, lang, type, from: origin, candidates: others });
          continue;
        }
        const target = others[0];
        const pk = pairKey(origin, target);
        if (!pairs.has(pk)) pairs.set(pk, { types: new Map() });
        const entry = pairs.get(pk);
        if (!entry.types.has(type)) entry.types.set(type, { directions: new Set(), langs: new Set(), tiers: [] });
        const rec = entry.types.get(type);
        rec.directions.add(origin);
        rec.langs.add(lang);
        if (type === 'synonym' && typeof tiers[term] === 'string') rec.tiers.push(tiers[term]);
      }
    };
    handle(def.synonyms_json, 'synonym');
    handle(def.antonyms_json, 'antonym');
  }

  const autoEdges = [];
  const oneSided = [];
  const wideSpan = []; // kept for queue-file compatibility; always empty now
  const conflicts = [];
  const levelCheck = []; // advisory: written pairs whose span is wide or unknown

  // A pair already decided by a human or AI edge (source manual/ai) never
  // re-enters the QUEUE buckets: the queue holds only pairs still needing a
  // call. autoEdges is deliberately untouched - the writer already skips
  // covered pairs (and reports them), and excluding resolved-covered pairs
  // here would make --apply drop the whole resolved graph.
  const decidedPairs = new Set(
    (content.concept_relations ?? [])
      .filter((e) => e.source !== 'resolved')
      .map((e) => pairKey(e.concept_a, e.concept_b)),
  );

  for (const [pk, entry] of pairs) {
    const decided = decidedPairs.has(pk);
    const [a, b] = pk.split('|');
    const span = levelSpan(conceptById.get(a), conceptById.get(b));
    if (entry.types.size > 1) {
      if (!decided) conflicts.push({ concept_a: a, concept_b: b, span, types: [...entry.types.keys()] });
      continue;
    }
    const [type] = entry.types.keys();
    const rec = entry.types.get(type);
    const mutual = rec.directions.has(a) && rec.directions.has(b);
    const langs = [...rec.langs].sort();
    const base = { concept_a: a, concept_b: b, relation_type: type, span, langs };
    if (!mutual) {
      if (!decided) oneSided.push({ ...base, asserted_by: [...rec.directions] });
      continue;
    }
    // A wide or unknown span no longer blocks the write; it is still worth a
    // human glance (one concept often sits at the wrong level), so it lands
    // in the levelCheck advisory list alongside the edge.
    if (span === null || span > MAX_LEVEL_SPAN) levelCheck.push(base);
    autoEdges.push({
      relation_id: relationId(type, a, b),
      relation_type: type,
      concept_a: a,
      concept_b: b,
      ...(type === 'synonym' ? { tier: mergeTiers(rec.tiers) } : {}),
      lang_scope_json: langs,
      source: 'resolved',
    });
  }

  // Bucket (c) wishlist with the Q1 promotion-bar yield: a dangling sense is
  // high-value when 2+ concepts reference it or it dangles in 2+ languages
  // (grouped cross-language by the concepts that reference it).
  const danglingList = [...dangling.values()].map((d) => ({
    term: d.term,
    lang: d.lang,
    referencedBy: [...d.from],
  }));
  const groups = new Map(); // sorted origin-concept set -> langs it dangles in
  for (const d of danglingList) {
    const gkey = d.referencedBy.slice().sort().join('|');
    if (!groups.has(gkey)) groups.set(gkey, { concepts: d.referencedBy, langs: new Set(), terms: [] });
    const g = groups.get(gkey);
    g.langs.add(d.lang);
    g.terms.push(`${d.lang}:${d.term}`);
  }
  const promotionCandidates = danglingList.filter((d) => {
    const g = groups.get(d.referencedBy.slice().sort().join('|'));
    return d.referencedBy.length >= 2 || (g && g.langs.size >= 2);
  });

  return {
    autoEdges: sortEdges(autoEdges),
    queue: { oneSided, wideSpan, conflicts, ambiguous },
    levelCheck,
    dangling: danglingList,
    danglingGroups: [...groups.values()].map((g) => ({ concepts: g.concepts, langs: [...g.langs].sort(), terms: g.terms })),
    promotionCandidates,
    phrases,
    selfRef,
    stats: {
      references,
      pairs: pairs.size,
      autoEdges: autoEdges.length,
      oneSided: oneSided.length,
      wideSpan: wideSpan.length,
      levelCheck: levelCheck.length,
      conflicts: conflicts.length,
      ambiguous: ambiguous.length,
      dangling: danglingList.length,
      promotionCandidates: promotionCandidates.length,
      phrases: phrases.length,
      selfRef: selfRef.length,
    },
  };
}

/** Stable order for reviewable git diffs: (relation_type, concept_a, concept_b). */
export function sortEdges(edges) {
  return edges.slice().sort(
    (x, y) =>
      x.relation_type.localeCompare(y.relation_type) ||
      x.concept_a.localeCompare(y.concept_a) ||
      x.concept_b.localeCompare(y.concept_b),
  );
}

/**
 * Write the resolved edges into `content.concept_relations`. Since Phase 5
 * (a flat string is consumed once its pair is decided), edges are the source
 * of truth and are PERMANENT: every existing edge is kept regardless of
 * source, and the given auto edges only add pairs that have none yet.
 * Removing an edge is an editorial act (reject, delete, merge cascade),
 * never a regeneration side effect. Mutates `content`;
 * returns { written, skippedCovered }.
 */
export function applyResolvedEdges(content, autoEdges) {
  const existing = content.concept_relations ?? [];
  const covered = new Set(existing.map((e) => pairKey(e.concept_a, e.concept_b)));
  const written = [];
  const skippedCovered = [];
  for (const edge of autoEdges) {
    const pk = pairKey(edge.concept_a, edge.concept_b);
    if (covered.has(pk)) {
      skippedCovered.push(edge);
      continue;
    }
    covered.add(pk);
    written.push(edge);
  }
  content.concept_relations = sortEdges([...existing, ...written]);
  return { written, skippedCovered };
}

/**
 * Phase 5: a flat synonym/antonym string is CONSUMED once its pair has been
 * decided - an edge of any type supersedes it, a remembered reject refutes
 * it. Removes those strings (and their tier entries) from the definitions.
 * Dangling strings stay (answer-support for words not in the lexicon yet),
 * ambiguous strings stay (pending a sense hint), phrases stay by design.
 * Mutates `content`; returns { removed, kept }.
 */
export function stripConsumedSupportStrings(content, { rejectedPairs = new Set() } = {}) {
  const index = buildSurfaceIndex(content);
  const edged = new Set((content.concept_relations ?? []).map((e) => pairKey(e.concept_a, e.concept_b)));
  let removed = 0;
  let kept = 0;
  for (const def of content.concept_definitions ?? []) {
    const lang = String(def.lang ?? '').toLowerCase();
    const byKey = index.get(lang);
    if (!byKey) continue;
    const origin = def.concept_id;
    const strip = (field) => {
      const list = parseList(def[field]);
      if (!list.length) return;
      const survivors = [];
      for (const raw of list) {
        const term = String(raw ?? '').trim();
        const targets = [...(byKey.get(surfaceKey(term)) ?? [])].filter((id) => id !== origin);
        const decided = targets.length === 1 &&
          (edged.has(pairKey(origin, targets[0])) || rejectedPairs.has(pairKey(origin, targets[0])));
        if (decided) {
          removed += 1;
          if (def.synonym_tiers_json && typeof def.synonym_tiers_json === 'object') {
            delete def.synonym_tiers_json[term];
          }
        } else {
          survivors.push(raw);
          kept += 1;
        }
      }
      def[field] = survivors;
    };
    strip('synonyms_json');
    strip('antonyms_json');
  }
  return { removed, kept };
}

/**
 * D8 merge rule for dedup_concepts: rewrite every edge endpoint `fromId` to
 * `intoId`, drop edges that become self-edges, collapse duplicates per
 * (relation_type, pair) - keeping non-resolved provenance when both exist.
 * Mutates `content`; returns { rewritten, droppedSelf, collapsed }.
 */
export function rewriteEdgesForMerge(content, fromId, intoId) {
  const edges = content.concept_relations ?? [];
  let rewritten = 0;
  let droppedSelf = 0;
  const byPair = new Map();
  for (const edge of edges) {
    let { concept_a: a, concept_b: b } = edge;
    if (a === fromId || b === fromId) {
      a = a === fromId ? intoId : a;
      b = b === fromId ? intoId : b;
      rewritten += 1;
      if (a === b) {
        droppedSelf += 1;
        continue;
      }
      [a, b] = normalizePair(a, b);
      edge.concept_a = a;
      edge.concept_b = b;
      edge.relation_id = relationId(edge.relation_type, a, b);
    }
    const key = pairKey(edge.concept_a, edge.concept_b);
    const prev = byPair.get(key);
    // One relation per pair: on collision prefer the human-touched edge.
    if (!prev || (prev.source === 'resolved' && edge.source !== 'resolved')) {
      byPair.set(key, edge);
    }
  }
  const collapsed = edges.length - droppedSelf - byPair.size;
  content.concept_relations = sortEdges([...byPair.values()]);
  return { rewritten, droppedSelf, collapsed };
}

/**
 * E4 warning lint: synonym-transitive pairs that are also antonyms.
 * For A-syn-B and B-syn-C, an A-ant-C edge is a contradiction to review.
 */
export function lintTransitiveContradictions(edges) {
  const syn = new Map(); // concept -> Set(neighbors via synonym)
  const ant = new Set(); // pairKey of antonym edges
  for (const e of edges ?? []) {
    if (e.relation_type === 'synonym') {
      if (!syn.has(e.concept_a)) syn.set(e.concept_a, new Set());
      if (!syn.has(e.concept_b)) syn.set(e.concept_b, new Set());
      syn.get(e.concept_a).add(e.concept_b);
      syn.get(e.concept_b).add(e.concept_a);
    } else if (e.relation_type === 'antonym') {
      ant.add(pairKey(e.concept_a, e.concept_b));
    }
  }
  const flagged = new Set();
  for (const [b, neighbors] of syn) {
    const list = [...neighbors];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const key = pairKey(list[i], list[j]);
        if (ant.has(key)) flagged.add(`${key} (via ${b})`);
      }
    }
  }
  return [...flagged].sort();
}

/** Connected components over synonym edges (for the derived clusters, D6). */
export function synonymComponents(edges) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(x) !== r) {
      const n = parent.get(x);
      parent.set(x, r);
      x = n;
    }
    return r;
  };
  for (const e of edges ?? []) {
    if (e.relation_type !== 'synonym') continue;
    const ra = find(e.concept_a);
    const rb = find(e.concept_b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map();
  for (const x of parent.keys()) {
    const r = find(x);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(x);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/**
 * Graph invariants (design section 5). Returns [{ kind, label, count, samples }];
 * empty array = healthy. Used by content_integrity's diagnose pass.
 */
export function diagnoseRelations(content) {
  const issues = [];
  const push = (kind, label, items) => {
    if (items.length) issues.push({ kind, label, count: items.length, samples: items.slice(0, 5) });
  };
  const edges = content.concept_relations ?? [];
  const conceptById = new Map((content.concepts ?? []).map((c) => [c.concept_id, c]));
  const langSet = new Set(LANGS);

  push('relation_orphan', 'edges referencing a missing concept',
    edges.filter((e) => !conceptById.has(e.concept_a) || !conceptById.has(e.concept_b)).map((e) => e.relation_id));
  push('relation_self_edge', 'self-edges',
    edges.filter((e) => e.concept_a === e.concept_b).map((e) => e.relation_id));
  push('relation_unordered', 'edges with unordered endpoints',
    edges.filter((e) => e.concept_a >= e.concept_b).map((e) => e.relation_id));
  const seen = new Map();
  const dupes = [];
  for (const e of edges) {
    const key = pairKey(e.concept_a, e.concept_b);
    if (seen.has(key)) dupes.push(`${seen.get(key)} vs ${e.relation_id}`);
    else seen.set(key, e.relation_id);
  }
  push('relation_duplicate_pair', 'pairs with more than one relation (one type per pair)', dupes);
  push('relation_bad_type', 'edges with an unknown relation_type',
    edges.filter((e) => !RELATION_TYPES.includes(e.relation_type)).map((e) => e.relation_id));
  push('relation_bad_source', 'edges with an unknown source',
    edges.filter((e) => !RELATION_SOURCES.includes(e.source)).map((e) => e.relation_id));
  push('relation_bad_tier', 'tier present on a non-synonym edge or with an unknown value',
    edges.filter((e) => (e.relation_type === 'synonym'
      ? e.tier !== undefined && !RELATION_TIERS.includes(e.tier)
      : e.tier !== undefined)).map((e) => e.relation_id));
  push('relation_bad_lang_scope', 'lang_scope must be null or a non-empty array of supported languages',
    edges.filter((e) => {
      const s = e.lang_scope_json;
      if (s === null || s === undefined) return false;
      return !Array.isArray(s) || s.length === 0 || s.some((l) => !langSet.has(l));
    }).map((e) => e.relation_id));
  push('relation_bad_id', 'relation_id does not match its deterministic recipe',
    edges.filter((e) => e.relation_id !== relationId(e.relation_type, e.concept_a, e.concept_b)).map((e) => e.relation_id));
  // The former relation_level_span invariant (adjacency) was retired on
  // 2026-07-16: wide spans are an advisory (analyzeRelations().levelCheck),
  // not an integrity error - level pacing is the consumer's concern.

  return issues;
}

/** Repair counterpart for the heal loop: drop edges whose endpoint is gone. */
export function repairRelationOrphans(content) {
  const edges = content.concept_relations ?? [];
  const conceptIds = new Set((content.concepts ?? []).map((c) => c.concept_id));
  const before = edges.length;
  content.concept_relations = edges.filter(
    (e) => conceptIds.has(e.concept_a) && conceptIds.has(e.concept_b),
  );
  return before - content.concept_relations.length;
}
