const RAW_LEXICON_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const PACK_ID_LEVEL_SEGMENT_PATTERN = /\.(A1|A2|B1|B2|C1|C2)\./i;
const PACK_ID_LEVEL_REPLACEMENT_PATTERN =
  /^(.*)\.(A1|A2|B1|B2|C1|C2)\.(.*)$/i;
const levelRanks = new Map(
  RAW_LEXICON_LEVELS.map((level, index) => [level, index]),
);

export const LEXICON_LEVELS = Object.freeze([...RAW_LEXICON_LEVELS]);
export const DEFAULT_LEXICON_LEVEL = LEXICON_LEVELS[0];

// Auto difficulty by CEFR level (0-100). `difficulty_score_auto` is an auto-derived
// field; when a concept has no explicit value this level curve is its defined default.
// Single source of truth for upsert + draft promotion so they can't diverge again.
export const LEVEL_DIFFICULTY_MAP = Object.freeze({
  A1: 20,
  A2: 35,
  B1: 50,
  B2: 65,
  C1: 80,
  C2: 95,
});

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeLexiconLevel(value) {
  const normalized = normalizeText(value).toUpperCase();
  return levelRanks.has(normalized) ? normalized : null;
}

export function defaultDifficultyForLevel(value) {
  const normalized = normalizeLexiconLevel(value) ?? DEFAULT_LEXICON_LEVEL;
  return LEVEL_DIFFICULTY_MAP[normalized];
}

export function normalizeLexiconLevels(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map(normalizeLexiconLevel).filter(Boolean))];
}

export function lexiconLevelRank(value) {
  const normalized = normalizeLexiconLevel(value);
  return normalized == null ? -1 : levelRanks.get(normalized);
}

export function compareLexiconLevels(left, right) {
  const leftRank = lexiconLevelRank(left);
  const rightRank = lexiconLevelRank(right);
  if (leftRank < 0 && rightRank < 0) {
    return 0;
  }
  if (leftRank < 0) {
    return 1;
  }
  if (rightRank < 0) {
    return -1;
  }
  return leftRank - rightRank;
}

export function inferLexiconLevelFromPackId(packId) {
  const match = PACK_ID_LEVEL_SEGMENT_PATTERN.exec(normalizeText(packId));
  return normalizeLexiconLevel(match?.[1]);
}

export function replaceLexiconPackIdLevel(packId, nextLevel) {
  const normalizedLevel = normalizeLexiconLevel(nextLevel);
  if (normalizedLevel == null) {
    return null;
  }
  const match = PACK_ID_LEVEL_REPLACEMENT_PATTERN.exec(normalizeText(packId));
  if (!match) {
    return null;
  }
  const [, prefix, , suffix] = match;
  return `${prefix}.${normalizedLevel.toLowerCase()}.${suffix}`;
}

export function resolveLexiconLevelsSupported({
  levelsSupported,
  packLevel,
  packId,
}) {
  const normalizedLevels = normalizeLexiconLevels(levelsSupported);
  if (normalizedLevels.length > 0) {
    return normalizedLevels;
  }
  const inferredLevel =
    normalizeLexiconLevel(packLevel) ?? inferLexiconLevelFromPackId(packId);
  return inferredLevel == null ? [] : [inferredLevel];
}

export function lexiconLevelsBefore(level) {
  const targetRank = lexiconLevelRank(level);
  if (targetRank < 0) {
    return [];
  }
  return LEXICON_LEVELS.filter(
    (candidateLevel) => lexiconLevelRank(candidateLevel) < targetRank,
  );
}
