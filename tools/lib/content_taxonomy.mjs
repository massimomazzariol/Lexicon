const CANONICAL_DOMAIN_TAGS = [
  'Daily',
  'Social',
  'Travel',
  'Work',
  'Action',
  'Abstract',
  'Body',
  'Characteristics',
  'Colors',
  'Communication',
  'Education',
  'Emotions',
  'Family',
  'Food',
  'Health',
  'Home',
  'Movement',
  'People',
  'Places',
  'Professions',
  'Space',
  'Time',
  'Weather',
];

const MACRO_DOMAIN_TAGS = ['Daily', 'Social', 'Travel', 'Work'];

const DOMAIN_TAG_ALIASES = new Map(
  [
    ['abstract', 'Abstract'],
    ['action', 'Action'],
    ['body', 'Body'],
    ['business', 'Work'],
    ['career', 'Work'],
    ['characteristic', 'Characteristics'],
    ['characteristics', 'Characteristics'],
    ['color', 'Colors'],
    ['colors', 'Colors'],
    ['communication', 'Communication'],
    ['daily', 'Daily'],
    ['education', 'Education'],
    ['emotion', 'Emotions'],
    ['emotions', 'Emotions'],
    ['family', 'Family'],
    ['food', 'Food'],
    ['health', 'Health'],
    ['home', 'Home'],
    ['house', 'Home'],
    ['job', 'Work'],
    ['jobs', 'Work'],
    ['movement', 'Movement'],
    ['people', 'People'],
    ['person', 'People'],
    ['persons', 'People'],
    ['place', 'Places'],
    ['places', 'Places'],
    ['profession', 'Professions'],
    ['professions', 'Professions'],
    ['social', 'Social'],
    ['space', 'Space'],
    ['time', 'Time'],
    ['travel', 'Travel'],
    ['weather', 'Weather'],
    ['work', 'Work'],
  ].map(([key, value]) => [key.toLowerCase(), value]),
);

const POS_BALANCE_TARGETS = {
  noun: { minShare: 0.2, maxShare: 0.45 },
  verb: { minShare: 0.2, maxShare: 0.35 },
  adj: { minShare: 0.1, maxShare: 0.25 },
  adv: { minShare: 0.08, maxShare: 0.2 },
  chunk: { minShare: 0.03, maxShare: 0.15 },
};

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function titleCaseWords(value) {
  return normalizeText(value)
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function normalizeDomainTag(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return null;
  const aliased = DOMAIN_TAG_ALIASES.get(normalized);
  if (aliased) {
    return aliased;
  }
  return titleCaseWords(normalized);
}

export function normalizeDomainTags(value, { fallback = [] } = {}) {
  const rawValues = Array.isArray(value) ? value : value == null ? [] : [value];
  const normalized = [];
  const seen = new Set();

  for (const raw of rawValues) {
    const tag = normalizeDomainTag(raw);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(tag);
  }

  if (!normalized.some((tag) => MACRO_DOMAIN_TAGS.includes(tag))) {
    const fallbackMacro = normalizeDomainTag(fallback[0] ?? 'Daily');
    if (fallbackMacro && !seen.has(fallbackMacro.toLowerCase())) {
      normalized.unshift(fallbackMacro);
    }
  }

  return normalized;
}

export function derivePackMacroDomainsFromConcepts(concepts) {
  const seen = new Set();
  for (const concept of Array.isArray(concepts) ? concepts : []) {
    const normalized = normalizeDomainTags(concept?.domain_tags ?? [], {
      fallback: ['Daily'],
    });
    for (const tag of normalized) {
      if (MACRO_DOMAIN_TAGS.includes(tag)) {
        seen.add(tag);
      }
    }
  }
  return MACRO_DOMAIN_TAGS.filter((tag) => seen.has(tag));
}

export {
  CANONICAL_DOMAIN_TAGS,
  MACRO_DOMAIN_TAGS,
  POS_BALANCE_TARGETS,
};
