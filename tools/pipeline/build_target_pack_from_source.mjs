import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { handleCliHelp } from '../lib/cli_help.mjs';
import { derivePackMacroDomainsFromConcepts } from '../lib/content_taxonomy.mjs';
import { DEFAULT_SOURCE_PACK_DIR } from '../lib/default_pack_paths.mjs';
import {
  LEXICON_LEVELS,
  lexiconLevelsBefore,
  lexiconLevelRank,
  normalizeLexiconLevel,
  replaceLexiconPackIdLevel,
} from '../lib/lexicon_conventions.mjs';
import { getNounMorphologyPlugin, getVerbMorphologyPlugin } from '../lib/language_plugins/build_language_plugin_registry.mjs';

const HELP_TEXT = `
Usage:
  pnpm node tools/pipeline/build_target_pack_from_source.mjs --dest-pack-dir <dir> --pack-id <id> --target-lang <lang> --level <level> --version <version> [options]

Options:
  --source-pack-dir <dir>  Canonical source pack directory. Default: packs/lexicon_source
  --dest-pack-dir <dir>    Runtime pack output directory
  --pack-id <id>           Runtime pack id, for example lexicon.de.a1.seed
  --target-lang <code>     Runtime target language code, for example de or en
  --level <level>          CEFR level to extract, for example A1 or B1
  --kind <kind>            Content kind: vocab (default) or expressions
  --version <version>      Runtime pack version string
  --generated-at <iso>     Override generated timestamp in the runtime manifest
  --dry-run                Compute the runtime pack summary without writing files
  -h, --help               Show this help message
`;

function requireSourceLicenseInfo(sourceManifest) {
  const licenseInfo = sourceManifest.license_info;
  if (typeof licenseInfo !== 'string' || licenseInfo.trim() === '') {
    throw new Error('source manifest.json is missing license_info; runtime packs must declare their content license');
  }
  return licenseInfo;
}

function parseArgs(argv) {
  handleCliHelp(argv, HELP_TEXT);
  const options = {
    sourcePackDir: DEFAULT_SOURCE_PACK_DIR,
    destPackDir: '',
    packId: '',
    targetLang: '',
    level: '',
    kind: 'vocab',
    version: '',
    generatedAt: new Date().toISOString(),
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source-pack-dir') options.sourcePackDir = argv[++i];
    else if (arg === '--dest-pack-dir') options.destPackDir = argv[++i];
    else if (arg === '--pack-id') options.packId = argv[++i];
    else if (arg === '--target-lang') options.targetLang = argv[++i];
    else if (arg === '--level') options.level = argv[++i];
    else if (arg === '--kind') options.kind = argv[++i];
    else if (arg === '--version') options.version = argv[++i];
    else if (arg === '--generated-at') options.generatedAt = argv[++i];
    else if (arg === '--dry-run') options.dryRun = true;
  }

  if (!options.destPackDir || !options.packId || !options.targetLang || !options.level || !options.version) {
    throw new Error(
      'Missing required args. Use --dest-pack-dir --pack-id --target-lang --level --version.',
    );
  }

  return options;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeLang(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeLevel(value) {
  return normalizeLexiconLevel(value);
}

function normalizeOptional(value) {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

/**
 * The publish gate: records still awaiting human review must NOT ship in a runtime
 * pack. Anything without the flag (legacy hand-authored/manual content) ships
 * normally. Mirrors review_autopromote.mjs - clean AI content is flipped to
 * `reviewed` there, so only the genuinely risky minority stays `needs_review` and
 * is filtered out here.
 */
function isShippable(row) {
  return row?.review_status !== 'needs_review';
}

function buildMorphologyPluginHelpers() {
  return {
    normalizeLang,
    normalizeOptional,
    normalizeText,
  };
}

function deterministicId(seed) {
  const hash = crypto.createHash('sha1').update(seed).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseTagsJson(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const decoded = JSON.parse(value);
      return decoded && typeof decoded === 'object' ? decoded : {};
    } catch (_) {
      return {};
    }
  }
  return typeof value === 'object' ? value : {};
}

function choosePrimaryForm(entries) {
  return [...entries].sort((a, b) => {
    if (a.lexemeIsPrimary !== b.lexemeIsPrimary) {
      return a.lexemeIsPrimary ? -1 : 1;
    }
    if (a.lexemeRank !== b.lexemeRank) {
      return a.lexemeRank - b.lexemeRank;
    }
    if ((a.row.sort_order ?? 0) !== (b.row.sort_order ?? 0)) {
      return (a.row.sort_order ?? 0) - (b.row.sort_order ?? 0);
    }
    return String(a.row.surface).localeCompare(String(b.row.surface));
  })[0];
}

function inferSlotKey(form) {
  const tags = parseTagsJson(form.tags_json);
  const explicit = normalizeOptional(tags.slot_key);
  if (explicit) {
    return explicit;
  }
  const lang = normalizeLang(form.lang);
  const numberValue = normalizeLang(form.number_value);
  const grammaticalCase = normalizeLang(form.grammatical_case);
  const definiteness = normalizeLang(form.definiteness);
  const nounMorphologyPlugin = getNounMorphologyPlugin(lang);
  const pluginSlotKey = nounMorphologyPlugin?.inferExistingSlotKey?.({
    form,
    numberValue,
    grammaticalCase,
    definiteness,
    helpers: buildMorphologyPluginHelpers(),
  });
  if (pluginSlotKey) {
    return pluginSlotKey;
  }

  if (grammaticalCase === 'none' && numberValue === 'sg') {
    return 'sg_core';
  }
  if (grammaticalCase === 'none' && numberValue === 'pl') {
    return 'pl_core';
  }
  if (grammaticalCase === 'none' && numberValue === 'none') {
    return 'core';
  }
  return null;
}

function nounCoreSlotKeyForLanguage(lang, numberValue) {
  const nounMorphologyPlugin = getNounMorphologyPlugin(lang);
  if (nounMorphologyPlugin?.coreSlotKeyForNumber) {
    return nounMorphologyPlugin.coreSlotKeyForNumber(numberValue);
  }
  return numberValue === 'pl' ? 'pl_core' : 'sg_core';
}

function nounGrammarStudyPairsForLanguage(lang) {
  return getNounMorphologyPlugin(lang)?.grammarStudyPairs ?? [];
}

function collectLangs(lexemes) {
  return [...new Set(lexemes.map((row) => normalizeLang(row.lang)).filter(Boolean))].sort();
}

function resolveConceptLevel(concept) {
  return normalizeLevel(concept.level_override) ?? normalizeLevel(concept.level_auto);
}

function createStudyUnitRow({
  packId,
  conceptId,
  sourceLang,
  targetLang,
  unitKind,
  sourceFormId,
  primaryExpectedFormId,
  extraExpectedFormIds,
  grammarTags,
  isCore,
  promptStyle,
  slotKey,
}) {
  return {
    study_unit_id: deterministicId(
      `${packId}:unit:${conceptId}:${sourceLang}:${targetLang}:${unitKind}:${sourceFormId}:${slotKey}`,
    ),
    concept_id: conceptId,
    source_lang: sourceLang,
    target_lang: targetLang,
    unit_kind: unitKind,
    source_form_id: sourceFormId,
    primary_expected_form_id: primaryExpectedFormId,
    extra_expected_form_ids: extraExpectedFormIds,
    acceptable_form_ids: [],
    is_core: isCore,
    status: 'approved',
    grammar_tags_json: grammarTags,
    prompt_style: promptStyle,
    difficulty_override: null,
    level_override: null,
    editor_notes: null,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourcePackDir = path.resolve(options.sourcePackDir);
  const destPackDir = path.resolve(options.destPackDir);
  const targetLang = normalizeLang(options.targetLang);

  const sourceManifest = readJson(path.join(sourcePackDir, 'manifest.json'));
  const sourceContent = readJson(path.join(sourcePackDir, 'content.json'));
  // Content kind partitions each CEFR level: expressions = idioms / fixed phrases
  // (pos='chunk'); vocab = everything else. Each (level, kind) ships as its own pack, so a
  // normal vocab deck never mixes in an expression and expressions download opt-in per level.
  const kind =
    String(options.kind ?? 'vocab').trim().toLowerCase() === 'expressions'
      ? 'expressions'
      : 'vocab';
  const targetLevel = normalizeLevel(options.level);
  if (!targetLevel) {
    throw new Error(
      `Unsupported level "${options.level}". Use ${LEXICON_LEVELS.join('/')}.`,
    );
  }

  const allConcepts = cloneJson(sourceContent.concepts ?? []);
  const targetLevelRank = lexiconLevelRank(targetLevel);
  const isChunk = (concept) => normalizeLang(concept.pos) === 'chunk';
  const concepts = allConcepts
    .filter((concept) => {
      if (!isShippable(concept)) return false; // held for review → drop the whole word
      const conceptLevel = resolveConceptLevel(concept);
      const conceptRank = lexiconLevelRank(conceptLevel);
      if (conceptRank < 0 || conceptRank !== targetLevelRank) return false;
      // vocab pack: non-chunks of this level; expressions pack: chunks of this level.
      return kind === 'expressions' ? isChunk(concept) : !isChunk(concept);
    })
    .map((concept) => ({ ...concept, level_auto: targetLevel, level_override: null }));
  const conceptIds = new Set(concepts.map((concept) => concept.concept_id));
  const lexemes = cloneJson(sourceContent.lexemes ?? []).filter((row) =>
    conceptIds.has(row.concept_id) && isShippable(row),
  );
  const lexemeIds = new Set(lexemes.map((row) => row.lexeme_id));
  const examples = cloneJson(sourceContent.examples ?? []).filter((row) =>
    conceptIds.has(row.concept_id) && isShippable(row),
  );
  const conceptDefinitions = cloneJson(sourceContent.concept_definitions ?? []).filter((row) =>
    conceptIds.has(row.concept_id) && isShippable(row),
  );
  const lexemeForms = cloneJson(sourceContent.lexeme_forms ?? []).filter((row) =>
    lexemeIds.has(row.lexeme_id),
  );
  const clusterMembers = cloneJson(sourceContent.cluster_members ?? []).filter((row) =>
    lexemeIds.has(row.lexeme_id),
  );
  const clusterIds = new Set(clusterMembers.map((row) => row.cluster_id));
  const clusters = cloneJson(sourceContent.clusters ?? []).filter((row) =>
    clusterIds.has(row.cluster_id),
  );

  const allLangs = collectLangs(lexemes);
  if (!allLangs.includes(targetLang)) {
    throw new Error(
      `Target language "${targetLang}" is not present in source content (${allLangs.join(', ')}).`,
    );
  }

  const sourceLangs = allLangs.filter((lang) => lang !== targetLang);
  const lexemeById = new Map(lexemes.map((row, index) => [row.lexeme_id, { row, rank: index }]));
  const formIdMap = new Map();
  const scopedForms = lexemeForms.map((row) => {
    const next = cloneJson(row);
    const nextId = deterministicId(`${options.packId}:form:${row.form_id}`);
    formIdMap.set(row.form_id, nextId);
    next.form_id = nextId;
    return next;
  });

  // Verb decomposition (additive, deterministic): tag each verb's core form with
  // verb_class / prefix / stem / aux via the language plugin. Runs in the live clone path
  // (this is what `rebuild` uses), does NOT change form_id, and skips a verb whose base
  // verb isn't known (conservative - never a wrong split). Other languages plug in the same way.
  for (const lang of collectLangs(lexemes)) {
    const verbPlugin = getVerbMorphologyPlugin(lang);
    if (!verbPlugin) continue;
    // Validate against ALL verbs in the source, not just this pack's level - otherwise a
    // separable verb whose base verb lives in another level (aufstehen[A1] vs stehen) is missed.
    const knownStems = verbPlugin.buildStemSet(sourceContent.lexemes);
    for (const form of scopedForms) {
      if (normalizeLang(form.lang) !== lang) continue;
      const tags = parseTagsJson(form.tags_json);
      if (tags.slot_key !== 'core') continue;
      const lexeme = lexemeById.get(form.lexeme_id)?.row;
      if (!lexeme || normalizeLang(lexeme.pos) !== 'verb') continue;
      const d = verbPlugin.analyze(lexeme.lemma || lexeme.text, { knownStems });
      if (!d) continue;
      form.tags_json = {
        ...tags,
        verb_class: d.verb_class,
        prefix: d.prefix,
        stem: d.stem,
        aux: d.aux,
        ...(d.needs_curation ? { needs_curation: true } : {}),
      };
    }
  }

  const formsByConceptLangSlot = new Map();
  for (const form of scopedForms) {
    if (normalizeLang(form.status) === 'deprecated') {
      continue;
    }
    const lexemeEntry = lexemeById.get(form.lexeme_id);
    if (!lexemeEntry || lexemeEntry.row.is_active === false) {
      continue;
    }
    const slotKey = inferSlotKey(form);
    if (!slotKey) {
      continue;
    }
    const key = `${lexemeEntry.row.concept_id}|${normalizeLang(form.lang)}|${slotKey}`;
    const bucket = formsByConceptLangSlot.get(key) ?? [];
    bucket.push({
      row: form,
      lexemeIsPrimary: lexemeEntry.row.is_primary === true,
      lexemeRank: lexemeEntry.rank,
    });
    formsByConceptLangSlot.set(key, bucket);
  }

  const studyUnits = [];

  const buildPair = ({
    packId,
    conceptId,
    sourceLang,
    targetLang,
    sourceForms,
    expectedForms,
    slotKey,
    unitKind,
    grammarTags = [],
    isCore,
    promptStyle,
  }) => {
    if (!sourceForms.length || !expectedForms.length) {
      return;
    }
    const primarySource = choosePrimaryForm(sourceForms);
    const primaryExpected = choosePrimaryForm(expectedForms);
    const extraExpectedFormIds = expectedForms
      .filter((entry) => entry.row.form_id !== primaryExpected.row.form_id)
      .map((entry) => entry.row.form_id);
    const reciprocalPrimary = choosePrimaryForm(sourceForms);
    const reciprocalExtraExpectedFormIds = sourceForms
      .filter((entry) => entry.row.form_id !== reciprocalPrimary.row.form_id)
      .map((entry) => entry.row.form_id);

    studyUnits.push(
      createStudyUnitRow({
        packId,
        conceptId,
        sourceLang,
        targetLang,
        unitKind,
        sourceFormId: primarySource.row.form_id,
        primaryExpectedFormId: primaryExpected.row.form_id,
        extraExpectedFormIds,
        grammarTags,
        isCore,
        promptStyle,
        slotKey,
      }),
    );
    studyUnits.push(
      createStudyUnitRow({
        packId,
        conceptId,
        sourceLang: targetLang,
        targetLang: sourceLang,
        unitKind: unitKind === 'core_prod' ? 'core_rec' : 'grammar_rec',
        sourceFormId: primaryExpected.row.form_id,
        primaryExpectedFormId: reciprocalPrimary.row.form_id,
        extraExpectedFormIds: reciprocalExtraExpectedFormIds,
        grammarTags,
        isCore,
        promptStyle,
        slotKey,
      }),
    );
  };

  for (const concept of concepts) {
    const conceptId = concept.concept_id;
    const conceptPos = normalizeLang(concept.pos);
    if (conceptPos !== 'noun') {
      const targetCoreForms =
        formsByConceptLangSlot.get(`${conceptId}|${targetLang}|core`) ?? [];
      for (const sourceLang of sourceLangs) {
        const sourceCoreForms =
          formsByConceptLangSlot.get(`${conceptId}|${sourceLang}|core`) ?? [];
        buildPair({
          packId: options.packId,
          conceptId,
          sourceLang,
          targetLang,
          sourceForms: sourceCoreForms,
          expectedForms: targetCoreForms,
          slotKey: 'core',
          unitKind: 'core_prod',
          isCore: true,
          promptStyle: 'translate',
        });
      }
      continue;
    }

    const targetSingularForms =
      formsByConceptLangSlot.get(
        `${conceptId}|${targetLang}|${nounCoreSlotKeyForLanguage(targetLang, 'sg')}`,
      ) ??
      [];
    const targetPluralForms =
      formsByConceptLangSlot.get(
        `${conceptId}|${targetLang}|${nounCoreSlotKeyForLanguage(targetLang, 'pl')}`,
      ) ??
      [];

    for (const sourceLang of sourceLangs) {
      const sourceSingularForms =
        formsByConceptLangSlot.get(
          `${conceptId}|${sourceLang}|${nounCoreSlotKeyForLanguage(sourceLang, 'sg')}`,
        ) ??
        [];
      const sourcePluralForms =
        formsByConceptLangSlot.get(
          `${conceptId}|${sourceLang}|${nounCoreSlotKeyForLanguage(sourceLang, 'pl')}`,
        ) ??
        [];

      buildPair({
        packId: options.packId,
        conceptId,
        sourceLang,
        targetLang,
        sourceForms: sourceSingularForms,
        expectedForms: targetSingularForms,
        slotKey: 'sg_core',
        unitKind: 'core_prod',
        isCore: true,
        promptStyle: 'translate',
      });
      buildPair({
        packId: options.packId,
        conceptId,
        sourceLang,
        targetLang,
        sourceForms: sourcePluralForms,
        expectedForms: targetPluralForms,
        slotKey: 'pl_core',
        unitKind: 'core_prod',
        isCore: true,
        promptStyle: 'translate',
      });

      for (const pair of nounGrammarStudyPairsForLanguage(targetLang)) {
        buildPair({
          packId: options.packId,
          conceptId,
          sourceLang,
          targetLang,
          sourceForms: pair.sourceNumber === 'pl' ? sourcePluralForms : sourceSingularForms,
          expectedForms:
            formsByConceptLangSlot.get(`${conceptId}|${targetLang}|${pair.expectedSlotKey}`) ?? [],
          slotKey: pair.expectedSlotKey,
          unitKind: 'grammar_prod',
          grammarTags: pair.grammarTags,
          isCore: false,
          promptStyle: 'translate_with_grammar_tag',
        });
      }
    }
  }

  const levelsSupported = [targetLevel];
  // Each pack relates to the earlier-level packs of the SAME kind (same pack-id pattern with
  // the level swapped): vocab -> earlier vocab, expressions -> earlier expressions.
  const relationChunkIds = lexiconLevelsBefore(targetLevel)
    .map((level) => replaceLexiconPackIdLevel(options.packId, level))
    .filter(Boolean);

  const destinationManifest = {
    pack_id: options.packId,
    pack_role: 'runtime',
    version: options.version,
    pack_level: targetLevel,
    kind,
    levels_supported: levelsSupported,
    relation_chunk_ids: relationChunkIds,
    languages_target_supported: [targetLang],
    gloss_languages_supported: sourceLangs,
    domains: derivePackMacroDomainsFromConcepts(concepts),
    license_info: requireSourceLicenseInfo(sourceManifest),
    content_file: 'content.json',
    generated_at: options.generatedAt,
    schema_version: 2,
  };

  // Defensive: the app imports these into tables with primary keys, so a duplicate
  // row makes the whole pack import fail. The source should already be clean; if a
  // dup slips through (e.g. a duplicated source concept), keep the first and warn
  // loudly rather than ship an unimportable pack. Never silently - the warning is
  // the signal to fix the source.
  const dedupeByKey = (rows, keyOf, label) => {
    const seen = new Set();
    const out = [];
    let dropped = 0;
    for (const row of rows ?? []) {
      const key = keyOf(row);
      if (seen.has(key)) {
        dropped += 1;
        continue;
      }
      seen.add(key);
      out.push(row);
    }
    if (dropped > 0) {
      console.warn(
        `[build_target] ${destinationManifest.pack_id}: dropped ${dropped} duplicate ${label} row(s) - fix the source pack.`,
      );
    }
    return out;
  };

  const destinationContent = {
    concepts: dedupeByKey(concepts, (r) => r.concept_id, 'concept'),
    lexemes: dedupeByKey(lexemes, (r) => r.lexeme_id, 'lexeme'),
    lexeme_forms: dedupeByKey(scopedForms, (r) => r.form_id, 'lexeme_form'),
    study_units: dedupeByKey(studyUnits, (r) => r.study_unit_id, 'study_unit'),
    examples,
    concept_definitions: dedupeByKey(
      conceptDefinitions,
      (r) => `${r.concept_id}|${r.lang}`,
      'concept_definition',
    ),
    clusters,
    cluster_members: clusterMembers,
  };

  const report = {
    source_pack_id: sourceManifest.pack_id,
    pack_id: destinationManifest.pack_id,
    version: destinationManifest.version,
    target_lang: targetLang,
    pack_level: targetLevel,
    levels_supported: levelsSupported,
    relation_chunk_ids: relationChunkIds,
    gloss_languages_supported: sourceLangs,
    concepts: concepts.length,
    lexemes: lexemes.length,
    lexeme_forms: scopedForms.length,
    study_units: studyUnits.length,
  };

  if (!options.dryRun) {
    fs.mkdirSync(destPackDir, { recursive: true });
    writeJson(path.join(destPackDir, 'manifest.json'), destinationManifest);
    writeJson(path.join(destPackDir, 'content.json'), destinationContent);
  }

  console.log(JSON.stringify(report, null, 2));
}

main();
