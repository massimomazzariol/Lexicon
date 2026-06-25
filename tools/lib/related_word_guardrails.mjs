import { lexiconLevelRank, normalizeLexiconLevel } from './lexicon_conventions.mjs';

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeLang(value) {
  return normalizeText(value).toLowerCase();
}

function isActiveLexeme(row) {
  if (!row || row.is_active === false) return false;
  return normalizeLang(row.status) !== 'deprecated';
}

function buildConceptIndex(content) {
  const concepts = Array.isArray(content.concepts) ? content.concepts : [];
  const lexemes = Array.isArray(content.lexemes) ? content.lexemes : [];
  const clusters = Array.isArray(content.clusters) ? content.clusters : [];
  const clusterMembers = Array.isArray(content.cluster_members)
    ? content.cluster_members
    : [];

  const conceptById = new Map(concepts.map((concept) => [concept.concept_id, concept]));
  const lexemeById = new Map();
  const lexemesByConcept = new Map();
  const clusterById = new Map(clusters.map((cluster) => [cluster.cluster_id, cluster]));
  const clusterMembersByCluster = new Map();

  for (const lexeme of lexemes) {
    if (!isActiveLexeme(lexeme)) continue;
    lexemeById.set(lexeme.lexeme_id, lexeme);
    const bucket = lexemesByConcept.get(lexeme.concept_id) ?? [];
    bucket.push(lexeme);
    lexemesByConcept.set(lexeme.concept_id, bucket);
  }

  for (const member of clusterMembers) {
    if (!lexemeById.has(member.lexeme_id)) continue;
    const bucket = clusterMembersByCluster.get(member.cluster_id) ?? [];
    bucket.push(member);
    clusterMembersByCluster.set(member.cluster_id, bucket);
  }

  return {
    conceptById,
    lexemeById,
    lexemesByConcept,
    clusterById,
    clusterMembersByCluster,
  };
}

function addCandidate(candidates, conceptId, payload) {
  const existing = candidates.get(conceptId);
  if (!existing) {
    candidates.set(conceptId, {
      concept_id: conceptId,
      score: payload.score,
      reasons: [payload.reason],
      sources: [payload.source],
      shared_domain_tags: [...payload.shared_domain_tags],
      shared_clusters: [...payload.shared_clusters],
    });
    return;
  }

  existing.score += payload.score;
  if (!existing.reasons.includes(payload.reason)) {
    existing.reasons.push(payload.reason);
  }
  if (!existing.sources.includes(payload.source)) {
    existing.sources.push(payload.source);
  }
  existing.shared_domain_tags = [...new Set([...existing.shared_domain_tags, ...payload.shared_domain_tags])];
  existing.shared_clusters = [...new Set([...existing.shared_clusters, ...payload.shared_clusters])];
}

function mergeCandidateMaps(target, source) {
  for (const [conceptId, candidate] of source.entries()) {
    const existing = target.get(conceptId);
    if (!existing) {
      target.set(conceptId, {
        concept_id: conceptId,
        score: candidate.score,
        reasons: [...candidate.reasons],
        sources: [...candidate.sources],
        shared_domain_tags: [...candidate.shared_domain_tags],
        shared_clusters: [...candidate.shared_clusters],
      });
      continue;
    }

    existing.score += candidate.score;
    existing.reasons = [...new Set([...existing.reasons, ...candidate.reasons])];
    existing.sources = [...new Set([...existing.sources, ...candidate.sources])];
    existing.shared_domain_tags = [
      ...new Set([...existing.shared_domain_tags, ...candidate.shared_domain_tags]),
    ];
    existing.shared_clusters = [
      ...new Set([...existing.shared_clusters, ...candidate.shared_clusters]),
    ];
  }
}

function collectSharedDomainTags(coreConceptIds, coverageByConcept, candidateConceptId) {
  const candidateConcept = coverageByConcept.get(candidateConceptId);
  if (!candidateConcept) return [];
  const shared = new Set();
  for (const coreConceptId of coreConceptIds) {
    const coreConcept = coverageByConcept.get(coreConceptId);
    for (const tag of coreConcept?.domain_tags ?? []) {
      if (candidateConcept.domain_tags?.includes(tag)) {
        shared.add(tag);
      }
    }
  }
  return [...shared];
}

function isWithinNearbyLevelRange(coreConceptIds, coverageByConcept, candidateConceptId) {
  const candidateCoverage = coverageByConcept.get(candidateConceptId);
  const candidateLevelRank = lexiconLevelRank(
    normalizeLexiconLevel(candidateCoverage?.level),
  );
  if (candidateLevelRank < 0) return false;
  return coreConceptIds.some((coreConceptId) => {
    const coreCoverage = coverageByConcept.get(coreConceptId);
    const coreLevelRank = lexiconLevelRank(normalizeLexiconLevel(coreCoverage?.level));
    return coreLevelRank >= 0 && Math.abs(candidateLevelRank - coreLevelRank) <= 1;
  });
}

function buildCollisionConceptSet(coreConceptIds, collisionSummary) {
  const collisionConceptIds = new Set();

  for (const group of collisionSummary.overloaded_terms ?? []) {
    const includesCore = group.concepts.some((concept) =>
      coreConceptIds.includes(concept.concept_id),
    );
    if (!includesCore) continue;
    for (const concept of group.concepts) {
      if (!coreConceptIds.includes(concept.concept_id)) {
        collisionConceptIds.add(concept.concept_id);
      }
    }
  }

  for (const pair of collisionSummary.pair_candidates ?? []) {
    const pairConceptIds = [pair.left.concept_id, pair.right.concept_id];
    const includesCore = pairConceptIds.some((conceptId) => coreConceptIds.includes(conceptId));
    if (!includesCore) continue;
    for (const conceptId of pairConceptIds) {
      if (!coreConceptIds.includes(conceptId)) {
        collisionConceptIds.add(conceptId);
      }
    }
  }

  return collisionConceptIds;
}

function collectClusterCandidates({ coreConceptIds, index, coverageByConcept, collisionConceptIds }) {
  const candidates = new Map();
  const coreLexemeIds = new Set(
    coreConceptIds.flatMap((conceptId) =>
      (index.lexemesByConcept.get(conceptId) ?? []).map((lexeme) => lexeme.lexeme_id),
    ),
  );

  for (const [clusterId, members] of index.clusterMembersByCluster.entries()) {
    const cluster = index.clusterById.get(clusterId);
    if (!cluster || normalizeLang(cluster.type) === 'confusables') continue;
    const clusterLexemeIds = new Set(members.map((member) => member.lexeme_id));
    const touchesCore = [...clusterLexemeIds].some((lexemeId) => coreLexemeIds.has(lexemeId));
    if (!touchesCore) continue;

    for (const member of members) {
      const lexeme = index.lexemeById.get(member.lexeme_id);
      if (!lexeme) continue;
      const conceptId = lexeme.concept_id;
      if (coreConceptIds.includes(conceptId) || collisionConceptIds.has(conceptId)) continue;
      const sharedDomainTags = collectSharedDomainTags(
        coreConceptIds,
        coverageByConcept,
        conceptId,
      );
      addCandidate(candidates, conceptId, {
        score: 4 + sharedDomainTags.length,
        reason: `shared_cluster:${cluster.label}`,
        source: 'cluster',
        shared_domain_tags: sharedDomainTags,
        shared_clusters: [cluster.label],
      });
    }
  }

  return candidates;
}

function collectDiscoveryCandidates({
  coreConceptIds,
  discoverySummary,
  coverageByConcept,
  collisionConceptIds,
}) {
  const candidates = new Map();

  for (const concept of discoverySummary.concepts ?? []) {
    if (coreConceptIds.includes(concept.concept_id) || collisionConceptIds.has(concept.concept_id)) {
      continue;
    }
    const sharedDomainTags = collectSharedDomainTags(
      coreConceptIds,
      coverageByConcept,
      concept.concept_id,
    );
    if (sharedDomainTags.length === 0) continue;
    if (!isWithinNearbyLevelRange(coreConceptIds, coverageByConcept, concept.concept_id)) {
      continue;
    }

    addCandidate(candidates, concept.concept_id, {
      score: 4 + sharedDomainTags.length,
      reason: 'discovery_neighbor_shared_domain',
      source: 'discovery',
      shared_domain_tags: sharedDomainTags,
      shared_clusters: [],
    });
  }

  return candidates;
}

export function buildRelatedWordsGuardrails({
  content,
  coreConceptIds,
  discoverySummary,
  collisionSummary,
  coverageSummary,
  maxNearbyFamily = 4,
}) {
  const coverageByConcept = new Map(
    (coverageSummary.concepts ?? []).map((concept) => [concept.concept_id, concept]),
  );
  const index = buildConceptIndex(content);
  const collisionConceptIds = buildCollisionConceptSet(coreConceptIds, collisionSummary);

  const clusterCandidates = collectClusterCandidates({
    coreConceptIds,
    index,
    coverageByConcept,
    collisionConceptIds,
  });
  const discoveryCandidates = collectDiscoveryCandidates({
    coreConceptIds,
    discoverySummary,
    coverageByConcept,
    collisionConceptIds,
  });

  const merged = new Map();
  mergeCandidateMaps(merged, clusterCandidates);
  mergeCandidateMaps(merged, discoveryCandidates);

  const nearbyFamily = [...merged.values()]
    .map((candidate) => {
      const concept = coverageByConcept.get(candidate.concept_id);
      return {
        concept_id: candidate.concept_id,
        level: concept?.level ?? null,
        pos: concept?.pos ?? null,
        labels: concept?.labels ?? {},
        reasons: candidate.reasons.sort(),
        shared_domain_tags: candidate.shared_domain_tags.sort(),
        shared_clusters: candidate.shared_clusters.sort(),
        score: candidate.score,
      };
    })
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return left.concept_id.localeCompare(right.concept_id);
    });

  const limited = nearbyFamily.slice(0, Math.max(1, maxNearbyFamily));
  const hiddenCount = Math.max(0, nearbyFamily.length - limited.length);

  return {
    nearby_family: limited,
    nearby_family_status:
      limited.length === 0
        ? 'manual_review_required'
        : hiddenCount > 0
          ? 'auto_bounded_with_hidden_candidates'
          : 'auto_bounded',
    nearby_family_hidden_count: hiddenCount,
    nearby_family_guardrails: {
      max_items: Math.max(1, maxNearbyFamily),
      allowed_sources: ['cluster', 'discovery'],
      excluded_collision_candidates: [...collisionConceptIds].sort(),
    },
  };
}
