import fs from 'node:fs';
import path from 'node:path';

import { handleCliHelp } from '../lib/cli_help.mjs';
import { DEFAULT_SOURCE_PACK_DIR } from '../lib/default_pack_paths.mjs';
import {
  collectEditorialInvariantViolations,
  formatEditorialInvariantViolation,
} from '../lib/editorial_invariants.mjs';
import {
  getLeadingArticleTokens,
} from '../lib/language_text_conventions.mjs';

const DEFAULT_PACK_DIR = DEFAULT_SOURCE_PACK_DIR;
const DEFAULT_OUT_DIR = 'docs/data';
const LEXEME_MORPHOLOGY_OVERRIDES_FILE = 'lexeme_morphology_overrides.json';
const HELP_TEXT = `
Usage:
  pnpm node tools/pipeline/quality_clean_pack.mjs [options]

Options:
  --pack-dir <dir>         Canonical source pack directory. Default: packs/lexicon_source
  --out-dir <dir>          Directory for JSON and CSV QA reports. Default: docs/data
  --apply                  Apply approved cleanup changes to source content
  --skip-example-cleanup   Leave spoiler examples untouched while still reporting them
  --label-lang <code>      Preferred label language for QA report rows
  -h, --help               Show this help message
`;

function parseArgs(argv) {
  handleCliHelp(argv, HELP_TEXT);
  const options = {
    packDir: DEFAULT_PACK_DIR,
    outDir: DEFAULT_OUT_DIR,
    apply: false,
    skipExampleCleanup: false,
    labelLang: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--pack-dir') options.packDir = argv[++i];
    else if (arg === '--out-dir') options.outDir = argv[++i];
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--skip-example-cleanup') options.skipExampleCleanup = true;
    else if (arg === '--label-lang') options.labelLang = argv[++i];
  }
  return options;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function loadLexemeMorphologyOverrides(packDir) {
  const filePath = path.join(packDir, LEXEME_MORPHOLOGY_OVERRIDES_FILE);
  if (!fs.existsSync(filePath)) {
    return new Map();
  }

  const raw = readJson(filePath);
  const source =
    raw?.lexeme_overrides && typeof raw.lexeme_overrides === 'object'
      ? raw.lexeme_overrides
      : {};
  const lexemeOverrides = new Map();

  for (const [lexemeId, override] of Object.entries(source)) {
    if (!lexemeId || !override || typeof override !== 'object') {
      continue;
    }
    lexemeOverrides.set(lexemeId, override);
  }

  return lexemeOverrides;
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeLang(value) {
  return normalizeText(value).toLowerCase();
}

function parseStringList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeText(entry)).filter(Boolean);
  }
  const one = normalizeText(value);
  return one ? [one] : [];
}

function normalizeSpoilerText(value, { stripDiacritics = true } = {}) {
  let normalized = normalizeText(value)
    .toLowerCase()
    .normalize('NFD');
  if (stripDiacritics) {
    normalized = normalized.replace(/[\u0300-\u036f]/g, '');
  } else {
    normalized = normalized.normalize('NFC');
  }
  return normalized
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const LEADING_ARTICLES = new Set(getLeadingArticleTokens());

function buildSpoilerForms(values) {
  const exactForms = new Set();
  const fuzzyForms = new Set();
  for (const raw of values) {
    const exactNormalized = normalizeSpoilerText(raw, {
      stripDiacritics: false,
    });
    const fuzzyNormalized = normalizeSpoilerText(raw);
    if (!exactNormalized || !fuzzyNormalized) continue;

    if (exactNormalized.includes(' ') || fuzzyNormalized.length >= 4) {
      fuzzyForms.add(fuzzyNormalized);
    } else {
      exactForms.add(exactNormalized);
    }

    const exactTokens = exactNormalized.split(' ');
    const fuzzyTokens = fuzzyNormalized.split(' ');
    if (fuzzyTokens.length > 1 && LEADING_ARTICLES.has(fuzzyTokens[0])) {
      const exactTail = exactTokens.slice(1).join(' ');
      const fuzzyTail = fuzzyTokens.slice(1).join(' ');
      if (exactTail.includes(' ') || fuzzyTail.length >= 4) {
        fuzzyForms.add(fuzzyTail);
      } else if (exactTail) {
        exactForms.add(exactTail);
      }
    }
    for (let index = 0; index < exactTokens.length; index += 1) {
      if (LEADING_ARTICLES.has(fuzzyTokens[index])) continue;
      if (fuzzyTokens[index].length >= 4) {
        fuzzyForms.add(fuzzyTokens[index]);
      }
    }
  }
  return {
    exact: [...exactForms],
    fuzzy: [...fuzzyForms],
  };
}

function containsSpoiler(example, spoilerForms) {
  const exactNormalized = normalizeSpoilerText(example, {
    stripDiacritics: false,
  });
  const fuzzyNormalized = normalizeSpoilerText(example);
  const exactForms = Array.isArray(spoilerForms?.exact) ? spoilerForms.exact : [];
  const fuzzyForms = Array.isArray(spoilerForms?.fuzzy) ? spoilerForms.fuzzy : [];
  if (!exactNormalized || (!exactForms.length && !fuzzyForms.length)) {
    return false;
  }

  const exactTokens = exactNormalized.split(' ').filter(Boolean);
  const exactPadded = ` ${exactNormalized} `;
  for (const form of exactForms) {
    if (!form) continue;
    if (form.includes(' ')) {
      if (exactPadded.includes(` ${form} `)) return true;
      continue;
    }
    if (exactTokens.includes(form)) {
      return true;
    }
  }

  if (!fuzzyNormalized) {
    return false;
  }

  const tokens = fuzzyNormalized.split(' ').filter(Boolean);
  const padded = ` ${fuzzyNormalized} `;
  for (const form of fuzzyForms) {
    if (!form) continue;
    if (form.includes(' ')) {
      if (padded.includes(` ${form} `)) return true;
      continue;
    }
    for (const token of tokens) {
      if (token === form) return true;
      if (form.length >= 4 && token.startsWith(form) && token.length - form.length <= 4) {
        return true;
      }
    }
  }
  return false;
}

function isContextPlaceholderExample(sentence) {
  const normalized = normalizeText(sentence).toLowerCase();
  return /^(kontext|contesto|context)\s*:/.test(normalized);
}

function ensureArray(root, key) {
  if (!Array.isArray(root[key])) root[key] = [];
  return root[key];
}

function ensureBucket(map, key) {
  if (!map.has(key)) {
    map.set(key, {
      supports: [],
      lexemes: [],
      examples: [],
      definitions: [],
    });
  }
  return map.get(key);
}

function writeCsv(filePath, rows) {
  const header = ['issue_type', 'concept_id', 'lang', 'item_id', 'text', 'action'];
  const lines = [header.join(',')];
  for (const row of rows) {
    const values = header.map((h) => {
      const value = row[h] ?? '';
      const escaped = String(value).replaceAll('"', '""');
      return `"${escaped}"`;
    });
    lines.push(values.join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function hasExplicitAntonyms(definitionRow) {
  if (!definitionRow || typeof definitionRow !== 'object') return false;
  const antonyms = definitionRow.antonyms_json;
  return Array.isArray(antonyms) && antonyms.some((entry) => normalizeText(entry));
}

function hasIntentionalNoAntonymPolicy(definitionRow) {
  if (!definitionRow || typeof definitionRow !== 'object') return false;
  const policy = definitionRow.antonym_policy_json;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return false;
  }
  const status = normalizeText(policy.status).toLowerCase();
  return status === 'intentionally_none';
}

function compareLabelCandidates(left, right) {
  if ((left.isPrimary === true) !== (right.isPrimary === true)) {
    return left.isPrimary === true ? -1 : 1;
  }
  const leftRank = Number.isFinite(left.frequencyRank) ? left.frequencyRank : Number.POSITIVE_INFINITY;
  const rightRank = Number.isFinite(right.frequencyRank) ? right.frequencyRank : Number.POSITIVE_INFINITY;
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  return left.index - right.index;
}

function collectConceptLabels(lexemes) {
  const labelsByConceptId = new Map();
  const candidateByConceptLang = new Map();

  for (const [index, row] of lexemes.entries()) {
    if (row?.is_active === false) {
      continue;
    }
    const conceptId = normalizeText(row?.concept_id);
    const lang = normalizeLang(row?.lang);
    const label = normalizeText(row?.text);
    if (!conceptId || !lang || !label) {
      continue;
    }

    const key = `${conceptId}|${lang}`;
    const candidate = {
      label,
      isPrimary: row?.is_primary === true,
      frequencyRank:
        Number.isFinite(row?.frequency_rank) ? Number(row.frequency_rank) : Number.POSITIVE_INFINITY,
      index,
    };
    const existing = candidateByConceptLang.get(key);
    if (!existing || compareLabelCandidates(candidate, existing) < 0) {
      candidateByConceptLang.set(key, candidate);
    }
  }

  for (const [key, candidate] of candidateByConceptLang.entries()) {
    const [conceptId, lang] = key.split('|');
    const bucket = labelsByConceptId.get(conceptId) ?? new Map();
    bucket.set(lang, candidate.label);
    labelsByConceptId.set(conceptId, bucket);
  }

  return labelsByConceptId;
}

function buildConceptLabelPayload(labelsByConceptId, conceptId, preferredLang) {
  const labelsByLang = labelsByConceptId.get(conceptId) ?? new Map();
  const sortedEntries = [...labelsByLang.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const labels = Object.fromEntries(sortedEntries);
  const labelSummary = sortedEntries
    .map(([lang, label]) => `${lang}: ${label}`)
    .join(' | ');

  if (!preferredLang) {
    return {
      label: labelSummary,
      label_lang: null,
      labels,
    };
  }

  const normalizedPreferredLang = normalizeLang(preferredLang);
  const direct = labelsByLang.get(normalizedPreferredLang);
  if (direct) {
    return {
      label: direct,
      label_lang: normalizedPreferredLang,
      labels,
    };
  }

  const fallback = sortedEntries[0] ?? null;
  return {
    label: fallback?.[1] ?? labelSummary,
    label_lang: fallback?.[0] ?? null,
    labels,
  };
}

function buildExampleAuthoringRequest({
  conceptId,
  lang,
  pos,
  labelPayload,
  targetText,
  shortDefinition,
  usageNote,
  forbiddenForms,
  spoilerForms,
  supportExamples,
}) {
  const readableForbiddenForms = [...new Set(forbiddenForms.map((value) => normalizeText(value)).filter(Boolean))];
  const instructionParts = [
    `Write 1 natural no-spoiler example in ${lang}.`,
    shortDefinition ? `Meaning: ${shortDefinition}` : null,
    usageNote ? `Usage note: ${usageNote}` : null,
    readableForbiddenForms.length > 0
      ? `Do not use: ${readableForbiddenForms.join(', ')}`
      : null,
  ].filter(Boolean);

  return {
    concept_id: conceptId,
    lang,
    pos,
    label: labelPayload.label,
    labels: labelPayload.labels,
    target_text: targetText,
    short_definition: shortDefinition,
    usage_note: usageNote,
    forbidden_forms: readableForbiddenForms,
    spoiler_forms_normalized: spoilerForms,
    support_examples_other_langs: supportExamples,
    author_prompt: instructionParts.join(' '),
    entry_template: {
      concept_id: conceptId,
      pos,
      translations: {
        [lang]: {
          text: targetText ?? '',
          definition: shortDefinition ?? null,
          usage_note: usageNote ?? null,
          examples: [
            {
              sentence: '',
            },
          ],
        },
      },
    },
  };
}

function assertNoEditorialInvariantViolations({ packDir, content }) {
  const violations = collectEditorialInvariantViolations({
    content,
    lexemeOverridesById: loadLexemeMorphologyOverrides(packDir),
  });
  if (violations.length === 0) {
    return;
  }

  const preview = violations
    .slice(0, 10)
    .map((violation) => `- ${formatEditorialInvariantViolation(violation)}`)
    .join('\n');
  const remainder =
    violations.length > 10
      ? `\n- ... and ${violations.length - 10} more`
      : '';
  throw new Error(
    [
      `Editorial invariant violations detected in ${path.relative(process.cwd(), packDir)} (${violations.length}).`,
      'Fix the source data before running quality_clean_pack.',
      preview + remainder,
    ].join('\n'),
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packDir = path.resolve(options.packDir);
  const outDir = path.resolve(options.outDir);
  const manifestPath = path.join(packDir, 'manifest.json');
  const contentPath = path.join(packDir, 'content.json');

  const manifest = readJson(manifestPath);
  const content = readJson(contentPath);
  assertNoEditorialInvariantViolations({ packDir, content });
  const packId = manifest.pack_id;

  const concepts = ensureArray(content, 'concepts');
  const lexemes = ensureArray(content, 'lexemes');
  const examples = ensureArray(content, 'examples');
  const conceptDefinitions = ensureArray(content, 'concept_definitions');
  delete content.glosses;
  delete content.gloss_aliases;

  const conceptSet = new Set(concepts.map((c) => c.concept_id));
  const conceptPosById = new Map(
    concepts.map((concept) => [
      concept.concept_id,
      normalizeText(concept.pos).toLowerCase(),
    ]),
  );
  const byConceptLang = new Map();
  const makeKey = (conceptId, lang) => `${conceptId}|${String(lang).toLowerCase()}`;

  for (const l of lexemes) {
    const key = makeKey(l.concept_id, l.lang);
    const bucket = ensureBucket(byConceptLang, key);
    bucket.lexemes.push(normalizeText(l.text));
    if (normalizeText(l.lemma)) {
      bucket.lexemes.push(normalizeText(l.lemma));
    }
  }
  for (const e of examples) {
    const key = makeKey(e.concept_id, e.lang);
    ensureBucket(byConceptLang, key).examples.push(e);
  }
  for (const d of conceptDefinitions) {
    const key = makeKey(d.concept_id, d.lang);
    const bucket = ensureBucket(byConceptLang, key);
    bucket.definitions.push(d);
    bucket.supports.push(
      ...parseStringList(d.synonyms_json).map((value) => normalizeText(value)),
    );
  }

  const csvRows = [];
  const spoilerExamplesRemoved = [];
  const placeholderExamplesRemoved = [];
  const spoilerSynonymsRemoved = [];
  const exampleAuthoringRequests = [];
  const missingDefinitions = [];
  const missingExamples = [];
  const splitCandidates = [];
  const antonymPolicyCovered = [];
  const antonymPolicyUnresolved = [];

  const definitionIndex = new Map();
  for (const d of conceptDefinitions) {
    definitionIndex.set(makeKey(d.concept_id, d.lang), d);
  }
  const initialDefinitionCount = definitionIndex.size;

  for (const [key, bucket] of byConceptLang.entries()) {
    const [conceptId, lang] = key.split('|');
    if (!conceptSet.has(conceptId)) continue;
    if (bucket.supports.length === 0 && bucket.lexemes.length === 0) continue;

    const defKey = makeKey(conceptId, lang);
    const existingDef = definitionIndex.get(defKey);
    if (!existingDef) {
      // A missing definition is reported for real authoring, never auto-filled with a
      // generic sentence (no hardcoded fallback content).
      missingDefinitions.push({ concept_id: conceptId, lang });
      csvRows.push({
        issue_type: 'missing_definition',
        concept_id: conceptId,
        lang,
        item_id: '',
        text: '',
        action: 'needs_definition',
      });
    }

    if (bucket.supports.length >= 10) {
      splitCandidates.push({
        concept_id: conceptId,
        lang,
        reason: 'high_support_synonym_count',
        aliases: bucket.supports.length,
      });
    }
  }

  let definitionRowsWithSynonyms = 0;
  let definitionRowsWithoutSynonyms = 0;
  for (const row of conceptDefinitions) {
    const lang = String(row.lang).toLowerCase();
    const key = makeKey(row.concept_id, lang);
    const bucket = byConceptLang.get(key) ?? {
      supports: [],
      lexemes: [],
      examples: [],
      definitions: [],
    };
    const spoilerForms = buildSpoilerForms(bucket.lexemes);
    const originalSynonyms = parseStringList(row.synonyms_json);
    const cleanedSynonyms = [];
    for (const synonym of originalSynonyms) {
      if (containsSpoiler(synonym, spoilerForms)) {
        spoilerSynonymsRemoved.push({
          concept_id: row.concept_id,
          lang,
          synonym,
        });
        csvRows.push({
          issue_type: 'spoiler_synonym',
          concept_id: row.concept_id,
          lang,
          item_id: '',
          text: synonym,
          action: options.apply ? 'removed' : 'to_remove',
        });
        continue;
      }
      cleanedSynonyms.push(synonym);
    }
    if (options.apply && cleanedSynonyms.length !== originalSynonyms.length) {
      row.synonyms_json = cleanedSynonyms;
    }
    if (cleanedSynonyms.length > 0) {
      definitionRowsWithSynonyms += 1;
    } else {
      definitionRowsWithoutSynonyms += 1;
    }
  }

  const examplesByConceptLang = new Map();
  for (const ex of examples) {
    const key = makeKey(ex.concept_id, ex.lang);
    if (!examplesByConceptLang.has(key)) examplesByConceptLang.set(key, []);
    examplesByConceptLang.get(key).push(ex);
  }

  const examplesToDrop = new Set();
  for (let i = 0; i < examples.length; i += 1) {
    const ex = examples[i];
    const conceptId = ex.concept_id;
    const lang = String(ex.lang).toLowerCase();
    const key = makeKey(conceptId, lang);
    const bucket = byConceptLang.get(key) ?? {
      supports: [],
      lexemes: [],
      examples: [],
      definitions: [],
    };
    const blockedValues = [
      ...bucket.supports,
      ...bucket.lexemes,
    ];
    const spoilerForms = buildSpoilerForms(blockedValues);
    const hasSpoiler = containsSpoiler(ex.sentence, spoilerForms);
    const isContextPlaceholder = isContextPlaceholderExample(ex.sentence);
    if (!hasSpoiler && !isContextPlaceholder) {
      continue;
    }
    if (!options.skipExampleCleanup) {
      examplesToDrop.add(i);
    }
    const removalPayload = {
      example_id: ex.example_id,
      concept_id: conceptId,
      lang,
      sentence: ex.sentence,
      reason: hasSpoiler ? 'spoiler' : 'context_label',
    };
    if (hasSpoiler) {
      spoilerExamplesRemoved.push(removalPayload);
    } else {
      placeholderExamplesRemoved.push(removalPayload);
    }
    csvRows.push({
      issue_type: hasSpoiler
        ? 'spoiler_example'
        : 'placeholder_example',
      concept_id: conceptId,
      lang,
      item_id: ex.example_id,
      text: ex.sentence,
      action:
        options.apply && !options.skipExampleCleanup ? 'removed' : 'to_remove',
    });
  }

  if (options.apply && !options.skipExampleCleanup && examplesToDrop.size > 0) {
    content.examples = examples.filter((_, i) => !examplesToDrop.has(i));
  }

  const refreshedExamples = options.apply ? ensureArray(content, 'examples') : examples;
  for (const [key, bucket] of byConceptLang.entries()) {
    const [conceptId, lang] = key.split('|');
    if (!conceptSet.has(conceptId)) continue;

    const current = refreshedExamples.filter(
      (e) => e.concept_id === conceptId && String(e.lang).toLowerCase() === lang,
    );
    if (current.length > 0) continue;

    // A missing example is reported for real authoring, never auto-filled with a generic
    // sentence (no hardcoded fallback content).
    missingExamples.push({ concept_id: conceptId, lang });
    csvRows.push({
      issue_type: 'missing_example',
      concept_id: conceptId,
      lang,
      item_id: '',
      text: '',
      action: 'needs_author_example',
    });
  }

  const conceptLabelsByConceptId = collectConceptLabels(lexemes);
  const refreshedExamplesByConceptLang = new Map();
  for (const ex of refreshedExamples) {
    const key = makeKey(ex.concept_id, ex.lang);
    const bucket = refreshedExamplesByConceptLang.get(key) ?? [];
    bucket.push(ex);
    refreshedExamplesByConceptLang.set(key, bucket);
  }

  for (const missing of missingExamples) {
    const conceptId = missing.concept_id;
    const lang = normalizeLang(missing.lang);
    const key = makeKey(conceptId, lang);
    const bucket = byConceptLang.get(key) ?? {
      supports: [],
      lexemes: [],
      examples: [],
      definitions: [],
    };
    const blockedValues = [...bucket.supports, ...bucket.lexemes];
    const spoilerForms = buildSpoilerForms(blockedValues);
    const labelPayload = buildConceptLabelPayload(
      conceptLabelsByConceptId,
      conceptId,
      lang,
    );
    const definitionRow = definitionIndex.get(key) ?? null;
    const supportExamples = {};
    for (const [exampleKey, rows] of refreshedExamplesByConceptLang.entries()) {
      const [exampleConceptId, exampleLang] = exampleKey.split('|');
      if (exampleConceptId !== conceptId || exampleLang === lang) continue;
      const sentences = rows
        .map((row) => normalizeText(row.sentence))
        .filter(Boolean);
      if (sentences.length <= 0) continue;
      supportExamples[exampleLang] = [...new Set(sentences)];
    }

    exampleAuthoringRequests.push(
      buildExampleAuthoringRequest({
        conceptId,
        lang,
        pos: conceptPosById.get(conceptId) ?? '',
        labelPayload,
        targetText: labelPayload.labels?.[lang] ?? null,
        shortDefinition: normalizeText(definitionRow?.short_definition) || null,
        usageNote: normalizeText(definitionRow?.usage_note) || null,
        forbiddenForms: blockedValues,
        spoilerForms,
        supportExamples,
      }),
    );
  }

  let conceptsWithExplicitAntonyms = 0;
  let conceptsWithoutExplicitAntonyms = 0;
  let conceptsWithoutAntonymsWithPolicy = 0;
  let conceptsWithoutAntonymsUnresolved = 0;
  const definitionRowsByConceptId = new Map();
  for (const row of conceptDefinitions) {
    const bucket = definitionRowsByConceptId.get(row.concept_id) ?? [];
    bucket.push(row);
    definitionRowsByConceptId.set(row.concept_id, bucket);
  }

  for (const concept of concepts) {
    const conceptDefinitionsForConcept =
      definitionRowsByConceptId.get(concept.concept_id) ?? [];
    const explicitAntonyms = conceptDefinitionsForConcept.some(
      hasExplicitAntonyms,
    );
    const intentionalNoAntonym = conceptDefinitionsForConcept.some(
      hasIntentionalNoAntonymPolicy,
    );

    if (explicitAntonyms) {
      conceptsWithExplicitAntonyms += 1;
      continue;
    }

    conceptsWithoutExplicitAntonyms += 1;
    if (intentionalNoAntonym) {
      conceptsWithoutAntonymsWithPolicy += 1;
      const labelPayload = buildConceptLabelPayload(
        conceptLabelsByConceptId,
        concept.concept_id,
        options.labelLang,
      );
      antonymPolicyCovered.push({
        concept_id: concept.concept_id,
        ...labelPayload,
        pos: concept.pos,
      });
      continue;
    }

    conceptsWithoutAntonymsUnresolved += 1;
    const labelPayload = buildConceptLabelPayload(
      conceptLabelsByConceptId,
      concept.concept_id,
      options.labelLang,
    );
    const unresolved = {
      concept_id: concept.concept_id,
      ...labelPayload,
      pos: concept.pos,
    };
    antonymPolicyUnresolved.push(unresolved);
    csvRows.push({
      issue_type: 'missing_antonym_policy',
      concept_id: concept.concept_id,
      lang: unresolved.label_lang ?? '',
      item_id: '',
      text: unresolved.label,
      action: options.apply ? 'review_required' : 'review_required',
    });
  }

  const timestamp = new Date().toISOString();
  const report = {
    pack_id: packId,
    apply: options.apply,
    timestamp,
    label_resolution: {
      requested_label_lang: normalizeLang(options.labelLang) || null,
      strategy:
        normalizeLang(options.labelLang) || null
          ? 'preferred_language_with_fallback'
          : 'all_labels_summary',
    },
    summary: {
      concepts: concepts.length,
      lexemes: lexemes.length,
      examples_before: examples.length,
      examples_after: (content.examples ?? examples).length,
      concept_definitions_before: initialDefinitionCount,
      concept_definitions_after: ensureArray(content, 'concept_definitions').length,
      support_synonym_rows: conceptDefinitions.reduce(
        (count, row) => count + parseStringList(row.synonyms_json).length,
        0,
      ),
      spoiler_synonyms_removed: spoilerSynonymsRemoved.length,
      spoiler_examples_removed: spoilerExamplesRemoved.length,
      placeholder_examples_removed: placeholderExamplesRemoved.length,
      example_authoring_requests: exampleAuthoringRequests.length,
      missing_definitions: missingDefinitions.length,
      missing_examples: missingExamples.length,
      split_candidates: splitCandidates.length,
      definition_rows_with_explicit_synonyms: definitionRowsWithSynonyms,
      definition_rows_without_explicit_synonyms: definitionRowsWithoutSynonyms,
      concepts_with_explicit_antonyms: conceptsWithExplicitAntonyms,
      concepts_without_explicit_antonyms: conceptsWithoutExplicitAntonyms,
      concepts_without_antonyms_with_policy: conceptsWithoutAntonymsWithPolicy,
      concepts_without_antonyms_unresolved: conceptsWithoutAntonymsUnresolved,
    },
    spoiler_synonyms_removed: spoilerSynonymsRemoved,
    spoiler_examples_removed: spoilerExamplesRemoved,
    placeholder_examples_removed: placeholderExamplesRemoved,
    example_authoring_requests: exampleAuthoringRequests,
    missing_definitions: missingDefinitions,
    missing_examples: missingExamples,
    split_candidates: splitCandidates,
    antonym_policy_covered: antonymPolicyCovered,
    antonym_policy_unresolved: antonymPolicyUnresolved,
  };

  fs.mkdirSync(outDir, { recursive: true });
  const stamp = timestamp.replace(/[:.]/g, '-');
  const reportJsonPath = path.join(outDir, `pack_quality_report_${stamp}.json`);
  const reportCsvPath = path.join(outDir, `pack_quality_report_${stamp}.csv`);
  const exampleAuthoringRequestsPath =
    exampleAuthoringRequests.length > 0
      ? path.join(outDir, `example_authoring_requests_${stamp}.json`)
      : null;
  const exampleAuthoringEntriesPath =
    exampleAuthoringRequests.length > 0
      ? path.join(outDir, `example_authoring_entries_${stamp}.json`)
      : null;
  writeJson(reportJsonPath, report);
  writeCsv(reportCsvPath, csvRows);
  if (exampleAuthoringRequestsPath && exampleAuthoringEntriesPath) {
    writeJson(exampleAuthoringRequestsPath, exampleAuthoringRequests);
    writeJson(
      exampleAuthoringEntriesPath,
      exampleAuthoringRequests.map((row) => row.entry_template),
    );
  }

  if (options.apply) {
    writeJson(contentPath, content);
  }

  console.log(JSON.stringify({
    ok: true,
    apply: options.apply,
    packDir,
    reportJsonPath,
    reportCsvPath,
    exampleAuthoringRequestsPath,
    exampleAuthoringEntriesPath,
    summary: report.summary,
  }, null, 2));
}

main();

