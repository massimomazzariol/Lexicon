import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { handleCliHelp } from '../lib/cli_help.mjs';
import { DEFAULT_SOURCE_PACK_DIR } from '../lib/default_pack_paths.mjs';
import {
  collectEditorialInvariantViolations,
  formatEditorialInvariantViolation,
} from '../lib/editorial_invariants.mjs';
import {
  inferSurfaceDefiniteness,
  stripLeadingArticle,
} from '../lib/language_text_conventions.mjs';
import { getNounMorphologyPlugin } from '../lib/language_plugins/build_language_plugin_registry.mjs';

const DEFAULT_PACK_DIR = DEFAULT_SOURCE_PACK_DIR;
const LEXEME_MORPHOLOGY_OVERRIDES_FILE = 'lexeme_morphology_overrides.json';
const CORE_LEXEME_FORM_PLUGIN_SOURCE = 'core:lexeme-form-generation';
const CORE_NOUN_FORM_PLUGIN_SOURCE = 'core:noun-form-generation';
const coreSlotDefinitions = [
  { slotKey: 'sg_core', numberValue: 'sg', grammaticalCase: 'none' },
  { slotKey: 'pl_core', numberValue: 'pl', grammaticalCase: 'none' },
];
const HELP_TEXT = `
Usage:
  pnpm node tools/pipeline/generate_pack_forms.mjs [options]

Options:
  --pack-dir <dir>         Canonical source pack directory. Default: packs/lexicon_source
  --dry-run                Compute noun-form generation output without rewriting files
  -h, --help               Show this help message
`;

function parseArgs(argv) {
  handleCliHelp(argv, HELP_TEXT);
  const options = {
    packDir: DEFAULT_PACK_DIR,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--pack-dir') options.packDir = argv[++i];
    else if (arg === '--dry-run') options.dryRun = true;
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

function assertNoEditorialInvariantViolations({
  packDir,
  content,
  lexemeOverridesById,
}) {
  const violations = collectEditorialInvariantViolations({
    content,
    lexemeOverridesById,
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
      'Fix the source noun surfaces or morphology overrides before generating v2 noun forms.',
      preview + remainder,
    ].join('\n'),
  );
}

function loadLexemeMorphologyOverrides(packDir) {
  const filePath = path.join(packDir, LEXEME_MORPHOLOGY_OVERRIDES_FILE);
  if (!fs.existsSync(filePath)) {
    return { filePath, lexemeOverrides: new Map() };
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
    const forms =
      override.forms && typeof override.forms === 'object' ? override.forms : {};
    lexemeOverrides.set(lexemeId, {
      countability: normalizeOptional(override.countability),
      pluralPolicy: normalizeOptional(override.plural_policy),
      notes: normalizeOptional(override.notes),
      forms: {
        sg_core: normalizeOptional(forms.sg_core),
        pl_core: normalizeOptional(forms.pl_core),
      },
    });
  }

  return { filePath, lexemeOverrides };
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeOptional(value) {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
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

function normalizeLang(value) {
  return normalizeText(value).toLowerCase();
}

function pickObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function mergeNotes(...values) {
  const seen = new Set();
  const merged = [];
  for (const value of values) {
    const normalized = normalizeOptional(value);
    if (!normalized) {
      continue;
    }
    for (const entry of normalized.split(';')) {
      const note = normalizeOptional(entry);
      if (!note || seen.has(note)) {
        continue;
      }
      seen.add(note);
      merged.push(note);
    }
  }
  return merged.length ? merged.join('; ') : null;
}

function deterministicId(seed) {
  const hash = crypto.createHash('sha1').update(seed).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function normalizeForSearch(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function inferPos(lexeme, conceptPos) {
  const raw = lexeme?.pos ?? conceptPos ?? '';
  const normalized = normalizeLang(raw);
  return normalized || 'chunk';
}

function cloneJsonValue(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

function normalizePolicyObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? cloneJsonValue(value)
    : null;
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeOptional(entry))
      .filter(Boolean);
  }
  const normalized = normalizeOptional(value);
  return normalized ? [normalized] : [];
}

function normalizeLanguageCodes(value) {
  return [...new Set(
    normalizeStringList(value)
      .map((entry) => normalizeLang(entry))
      .filter(Boolean),
  )].sort();
}

function isSourcePackManifest(manifest) {
  return normalizeLang(manifest?.pack_role) === 'source';
}

function collectContentLanguages(content) {
  return normalizeLanguageCodes([
    ...((content.lexemes ?? []).map((row) => row.lang)),
    ...((content.lexeme_forms ?? []).map((row) => row.lang)),
    ...((content.concept_definitions ?? []).map((row) => row.lang)),
    ...((content.examples ?? []).flatMap((row) => [row.lang, row.translation_lang])),
    ...((content.clusters ?? []).map((row) => row.lang)),
  ]);
}

function resolvePackLanguagePlan(manifest, content) {
  if (isSourcePackManifest(manifest)) {
    return {
      languagesPresent: normalizeLanguageCodes(
        Array.isArray(manifest.languages_present) && manifest.languages_present.length
          ? manifest.languages_present
          : collectContentLanguages(content),
      ),
      targetLangs: [],
      sourceLangs: [],
      embedsStudyUnits: false,
    };
  }

  return {
    languagesPresent: normalizeLanguageCodes([
      ...normalizeStringList(manifest.languages_target_supported),
      ...normalizeStringList(manifest.gloss_languages_supported),
    ]),
    targetLangs: normalizeLanguageCodes(manifest.languages_target_supported),
    sourceLangs: normalizeLanguageCodes(manifest.gloss_languages_supported),
    embedsStudyUnits: true,
  };
}

function mergeUniqueStrings(primary = [], secondary = []) {
  const seen = new Set();
  const merged = [];
  for (const value of [...primary, ...secondary]) {
    const normalized = normalizeOptional(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    merged.push(normalized);
  }
  return merged;
}

function incrementCounter(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function cloneConceptDefinition(row) {
  return {
    concept_id: row.concept_id,
    lang: row.lang,
    short_definition: normalizeOptional(row.short_definition),
    usage_note: normalizeOptional(row.usage_note),
    context_tags_json: Array.isArray(row.context_tags_json)
      ? [...row.context_tags_json]
      : [],
    source: normalizeOptional(row.source) ?? 'manual',
    synonyms_json: normalizeStringList(row.synonyms_json),
    antonyms_json: normalizeStringList(row.antonyms_json),
    antonym_policy_json: normalizePolicyObject(row.antonym_policy_json),
    hint_text: normalizeOptional(row.hint_text),
  };
}

function buildConceptDefinitionMap(content) {
  const rows = Array.isArray(content.concept_definitions)
    ? content.concept_definitions.map(cloneConceptDefinition)
    : [];
  return { rows };
}

function normalizeGender(rawGender) {
  const normalized = normalizeLang(rawGender);
  if (['m', 'masc', 'masculine', 'der'].includes(normalized)) return 'masc';
  if (['f', 'fem', 'feminine', 'die'].includes(normalized)) return 'fem';
  if (['n', 'neut', 'neuter', 'das'].includes(normalized)) return 'neut';
  if (normalized === 'common') return 'common';
  return 'none';
}

function buildMorphologyPluginHelpers() {
  return {
    isTruthy,
    normalizeGender,
    normalizeLang,
    normalizeOptional,
    normalizeText,
    pickObject,
    stripLeadingArticle,
  };
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

function lexemeMorphologyOverridePluginSource(lang) {
  return `override:${lang}:lexeme-morphology`;
}

function inferExistingSlotKey(form) {
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

function buildExistingFormsByLexeme(forms) {
  const formsByLexeme = new Map();
  for (const form of Array.isArray(forms) ? forms : []) {
    const lexemeId = normalizeOptional(form.lexeme_id);
    if (!lexemeId) {
      continue;
    }
    const bucket = formsByLexeme.get(lexemeId) ?? [];
    bucket.push(form);
    formsByLexeme.set(lexemeId, bucket);
  }
  return formsByLexeme;
}

function findExistingSurface(formsByLexeme, lexemeId, slotKey) {
  const bucket = formsByLexeme.get(lexemeId) ?? [];
  const match = bucket.find((form) => inferExistingSlotKey(form) === slotKey);
  return normalizeOptional(match?.surface);
}

function findExistingForm(formsByLexeme, lexemeId, slotKey) {
  const bucket = formsByLexeme.get(lexemeId) ?? [];
  return (
    bucket.find((form) => inferExistingSlotKey(form) === slotKey) ?? null
  );
}

function isTruthy(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = normalizeLang(value);
  return normalized === 'true' || normalized === '1';
}

function buildLexemeMetadata({
  lexeme,
  conceptPos,
  isPrimary,
  isDuplicateExact,
  editorialOverride,
  nounMorphologyPlugin,
}) {
  const lang = normalizeLang(lexeme.lang);
  const pos = inferPos(lexeme, conceptPos);
  const baseText = normalizeText(lexeme.text);
  const lemma = stripLeadingArticle(baseText, lang);
  const existingNotes = normalizeOptional(lexeme.notes);
  const duplicateNote = isDuplicateExact ? 'duplicate_surface_v2' : null;
  const editorialNote = normalizeOptional(editorialOverride?.notes);
  const pluginHelpers = buildMorphologyPluginHelpers();

  const finalLexeme = {
    lexeme_id: lexeme.lexeme_id,
    concept_id: lexeme.concept_id,
    lang: lexeme.lang,
    text: lexeme.text,
    frequency_rank: lexeme.frequency_rank ?? null,
    lemma: lemma || baseText,
    pos,
    gender:
      nounMorphologyPlugin?.normalizeLexemeGender
        ? nounMorphologyPlugin.normalizeLexemeGender(lexeme, pluginHelpers)
        : normalizeOptional(lexeme.gender) ?? 'none',
    countability:
      editorialOverride?.countability ??
      normalizeOptional(lexeme.countability) ??
      'none',
    register: normalizeOptional(lexeme.register) ?? 'neutral',
    meaning_status: normalizeOptional(lexeme.meaning_status) ?? 'exact',
    is_primary: isDuplicateExact ? false : isPrimary,
    status: isDuplicateExact
      ? 'deprecated'
      : normalizeOptional(lexeme.status) ?? 'approved',
    notes: mergeNotes(existingNotes, editorialNote, duplicateNote),
    is_active: isDuplicateExact ? false : lexeme.is_active !== false,
    article_nom_sg_def: normalizeOptional(lexeme.article_nom_sg_def),
    plural: normalizeOptional(lexeme.plural),
    n_declension: lexeme.n_declension === true,
    plural_adds_n_in_dative:
      lexeme.plural_adds_n_in_dative === false ? false : true,
    case_overrides_json:
      nounMorphologyPlugin?.normalizeCaseOverrides
        ? nounMorphologyPlugin.normalizeCaseOverrides(lexeme, pluginHelpers)
        : pickObject(lexeme?.case_overrides_json ?? lexeme?.case_overrides),
  };
  return finalLexeme;
}

function stripAuthoringLexemeFields(lexeme) {
  const {
    article_nom_sg_def: _articleNomSgDef,
    plural: _plural,
    n_declension: _nDeclension,
    plural_adds_n_in_dative: _pluralAddsNInDative,
    case_overrides_json: _caseOverridesJson,
    ...runtimeLexeme
  } = lexeme;
  return runtimeLexeme;
}

function createFormRow({
  packId,
  lexeme,
  lang,
  surface,
  numberValue,
  grammaticalCase,
  definiteness,
  formRole,
  sortOrder,
  pluginSource,
  tags,
  existingForm,
}) {
  const normalizedSurface = normalizeText(surface);
  if (!normalizedSurface) {
    return null;
  }

  // Stable identity = lexeme + language + grammatical SLOT (slot_key), NOT the surface.
  // The surface is mutable payload (curating a strong-verb Stammform rewrites it); keying the
  // id on it would re-mint the id and orphan SRS progress. slot_key also disambiguates verb
  // slots, which all share number/case/definiteness = 'none' (so the old tuple collided).
  const slotKey = tags?.slot_key ?? `${numberValue}:${grammaticalCase}:${definiteness}`;
  const existingSlotKey = existingForm
    ? (existingForm.tags_json?.slot_key
        ?? `${normalizeLang(existingForm.number_value)}:${normalizeLang(existingForm.grammatical_case)}:${normalizeLang(existingForm.definiteness)}`)
    : null;
  const canReuseExistingId =
    existingForm &&
    normalizeOptional(existingForm.lexeme_id) === lexeme.lexeme_id &&
    normalizeLang(existingForm.lang) === lang &&
    existingSlotKey === slotKey; // surface intentionally excluded → id survives surface edits

  return {
    form_id: canReuseExistingId
      ? existingForm.form_id
      : deterministicId(`${packId}:form:${lexeme.lexeme_id}:${lang}:${slotKey}`),
    lexeme_id: lexeme.lexeme_id,
    lang,
    surface: normalizedSurface,
    surface_search: normalizeForSearch(normalizedSurface),
    number_value: numberValue,
    grammatical_case: grammaticalCase,
    definiteness,
    form_role: formRole,
    status: 'approved',
    sort_order: sortOrder,
    plugin_source: pluginSource,
    editor_notes: null,
    tags_json: tags,
  };
}

function pushForm(rows, row, metaRows, meta) {
  if (!row) return;
  rows.push(row);
  metaRows.push({ ...meta, row });
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

function choosePrimaryForm(forms) {
  return [...forms].sort((a, b) => {
    if (a.lexemeIsPrimary !== b.lexemeIsPrimary) {
      return a.lexemeIsPrimary ? -1 : 1;
    }
    if (a.lexemeRank !== b.lexemeRank) {
      return a.lexemeRank - b.lexemeRank;
    }
    if (a.row.sort_order !== b.row.sort_order) {
      return (a.row.sort_order ?? 0) - (b.row.sort_order ?? 0);
    }
    return a.row.surface.localeCompare(b.row.surface);
  })[0];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packDir = path.resolve(options.packDir);
  const manifestPath = path.join(packDir, 'manifest.json');
  const contentPath = path.join(packDir, 'content.json');
  const manifest = readJson(manifestPath);
  const content = readJson(contentPath);
  const lexemeMorphologyOverrides = loadLexemeMorphologyOverrides(packDir);
  assertNoEditorialInvariantViolations({
    packDir,
    content,
    lexemeOverridesById: lexemeMorphologyOverrides.lexemeOverrides,
  });
  const packId = normalizeText(manifest.pack_id);
  if (!packId) {
    throw new Error('manifest.pack_id is required.');
  }

  const concepts = Array.isArray(content.concepts) ? content.concepts : [];
  const conceptPosById = new Map(
    concepts.map((concept) => [concept.concept_id, concept.pos]),
  );
  const rawLexemes = Array.isArray(content.lexemes) ? content.lexemes : [];
  const existingFormsByLexeme = buildExistingFormsByLexeme(content.lexeme_forms);
  const lexemeRankById = new Map();
  const exactSurfaceSeen = new Set();
  const primarySeen = new Set();
  const lexemes = rawLexemes.map((lexeme, index) => {
    const conceptPos = conceptPosById.get(lexeme.concept_id);
    const normalizedSurface = normalizeForSearch(lexeme.text);
    const duplicateKey = `${lexeme.concept_id}|${normalizeLang(lexeme.lang)}|${normalizedSurface}`;
    const primaryKey = `${lexeme.concept_id}|${normalizeLang(lexeme.lang)}`;
    const isDuplicateExact = exactSurfaceSeen.has(duplicateKey);
    const isPrimary = !primarySeen.has(primaryKey);
    exactSurfaceSeen.add(duplicateKey);
    if (!isDuplicateExact) {
      primarySeen.add(primaryKey);
    }
    lexemeRankById.set(lexeme.lexeme_id, index);
    const editorialOverride =
      lexemeMorphologyOverrides.lexemeOverrides.get(lexeme.lexeme_id) ?? null;
    const nounMorphologyPluginCandidate = getNounMorphologyPlugin(lexeme.lang);
    const nounMorphologyPlugin =
      nounMorphologyPluginCandidate?.applyToSourceGeneration === false
        ? null
        : nounMorphologyPluginCandidate;
    return buildLexemeMetadata({
      lexeme,
      conceptPos,
      isPrimary,
      isDuplicateExact,
      editorialOverride,
      nounMorphologyPlugin,
    });
  });
  const { rows: conceptDefinitions } = buildConceptDefinitionMap(content);

  const forms = [];
  const formMeta = [];
  const nounsTotal = concepts.filter((concept) => concept.pos === 'noun').length;
  const nonNounConceptsTotal = concepts.length - nounsTotal;
  const nounPluralCoreFormsByLang = new Map();
  let nonNounCoreForms = 0;

  for (const lexeme of lexemes) {
    if (lexeme.is_active === false) {
      continue;
    }
    const editorialOverride =
      lexemeMorphologyOverrides.lexemeOverrides.get(lexeme.lexeme_id) ?? null;
    const lang = normalizeLang(lexeme.lang);
    const pos = inferPos(lexeme, conceptPosById.get(lexeme.concept_id));
    if (pos !== 'noun') {
      const existingCoreForm = findExistingForm(
        existingFormsByLexeme,
        lexeme.lexeme_id,
        'core',
      );
      const existingSurface =
        normalizeOptional(existingCoreForm?.surface) ??
        normalizeOptional(lexeme.text);
      const coreRow = createFormRow({
        packId,
        lexeme,
        lang,
        surface: existingSurface,
        numberValue: 'none',
        grammaticalCase: 'none',
        definiteness: 'none',
        formRole: 'core',
        sortOrder: 0,
        pluginSource: CORE_LEXEME_FORM_PLUGIN_SOURCE,
        tags: { slot_key: 'core' },
        existingForm: existingCoreForm,
      });
      pushForm(forms, coreRow, formMeta, {
        conceptId: lexeme.concept_id,
        lexemeId: lexeme.lexeme_id,
        lang,
        slotKey: 'core',
        lexemeIsPrimary: lexeme.is_primary === true,
        lexemeRank: lexemeRankById.get(lexeme.lexeme_id) ?? 0,
      });
      if (coreRow) {
        nonNounCoreForms += 1;
      }
      continue;
    }

    const nounMorphologyPluginCandidate = getNounMorphologyPlugin(lang);
    const nounMorphologyPlugin =
      nounMorphologyPluginCandidate?.applyToSourceGeneration === false
        ? null
        : nounMorphologyPluginCandidate;
    if (nounMorphologyPlugin) {
      const pluginHelpers = buildMorphologyPluginHelpers();
      const lemma = lexeme.lemma ?? lexeme.text;
      if (!nounMorphologyPlugin.supportsLexeme(lexeme, pluginHelpers)) {
        continue;
      }
      for (const [slotIndex, slot] of nounMorphologyPlugin.slotDefinitions.entries()) {
        const existingForm = findExistingForm(
          existingFormsByLexeme,
          lexeme.lexeme_id,
          slot.slotKey,
        );
        const existingSurface = normalizeOptional(existingForm?.surface);
        if (!nounMorphologyPlugin.shouldEmitSlot({
          lexeme,
          slot,
          existingSurface,
          helpers: pluginHelpers,
        })) {
          continue;
        }
        const surface =
          existingSurface ??
          nounMorphologyPlugin.deriveSurface({
            lemma,
            lexeme,
            slot,
            helpers: pluginHelpers,
          });
        if (!surface) {
          continue;
        }
        if (slot.countsTowardPluralCoreMetric === true) {
          incrementCounter(nounPluralCoreFormsByLang, lang);
        }
        const row = createFormRow({
          packId,
          lexeme,
          lang,
          surface,
          numberValue: slot.numberValue,
          grammaticalCase: slot.grammaticalCase,
          definiteness: slot.definiteness,
          formRole: slot.formRole,
          sortOrder: slotIndex,
          pluginSource: nounMorphologyPlugin.pluginSource,
          tags: {
            slot_key: slot.slotKey,
            grammar_tags: slot.grammarTags,
          },
          existingForm,
        });
        pushForm(forms, row, formMeta, {
          conceptId: lexeme.concept_id,
          lexemeId: lexeme.lexeme_id,
          lang,
          slotKey: slot.slotKey,
          lexemeIsPrimary: lexeme.is_primary === true,
          lexemeRank: lexemeRankById.get(lexeme.lexeme_id) ?? 0,
        });
      }
      continue;
    }

    const existingSingularForm = findExistingForm(
      existingFormsByLexeme,
      lexeme.lexeme_id,
      'sg_core',
    );
    const singularSurface =
      editorialOverride?.forms?.sg_core ?? normalizeText(lexeme.text);
    const singularRow = createFormRow({
      packId,
      lexeme,
      lang,
      surface: singularSurface,
      numberValue: 'sg',
      grammaticalCase: 'none',
      definiteness: inferSurfaceDefiniteness(singularSurface, lang),
        formRole: 'core',
        sortOrder: 0,
        pluginSource: editorialOverride?.forms?.sg_core
          ? lexemeMorphologyOverridePluginSource(lang)
          : CORE_NOUN_FORM_PLUGIN_SOURCE,
        tags: { slot_key: 'sg_core' },
        existingForm: existingSingularForm,
      });
    pushForm(forms, singularRow, formMeta, {
      conceptId: lexeme.concept_id,
      lexemeId: lexeme.lexeme_id,
      lang,
      slotKey: 'sg_core',
      lexemeIsPrimary: lexeme.is_primary === true,
      lexemeRank: lexemeRankById.get(lexeme.lexeme_id) ?? 0,
    });

    const existingPluralForm = findExistingForm(
      existingFormsByLexeme,
      lexeme.lexeme_id,
      'pl_core',
    );
    const explicitPlural =
      editorialOverride?.forms?.pl_core ??
      normalizeOptional(existingPluralForm?.surface) ??
      normalizeOptional(lexeme.plural);
    if (explicitPlural) {
      const pluralRow = createFormRow({
        packId,
        lexeme,
        lang,
        surface: explicitPlural,
        numberValue: 'pl',
        grammaticalCase: 'none',
        definiteness: inferSurfaceDefiniteness(explicitPlural, lang),
        formRole: 'core',
        sortOrder: 1,
        pluginSource: editorialOverride?.forms?.pl_core
          ? lexemeMorphologyOverridePluginSource(lang)
          : CORE_NOUN_FORM_PLUGIN_SOURCE,
        tags: { slot_key: 'pl_core' },
        existingForm: existingPluralForm,
      });
      pushForm(forms, pluralRow, formMeta, {
        conceptId: lexeme.concept_id,
        lexemeId: lexeme.lexeme_id,
        lang,
        slotKey: 'pl_core',
        lexemeIsPrimary: lexeme.is_primary === true,
        lexemeRank: lexemeRankById.get(lexeme.lexeme_id) ?? 0,
      });
    }
  }

  const formsByConceptAndSlot = new Map();
  for (const entry of formMeta) {
    const key = `${entry.conceptId}|${entry.lang}|${entry.slotKey}`;
    const bucket = formsByConceptAndSlot.get(key) ?? [];
    bucket.push(entry);
    formsByConceptAndSlot.set(key, bucket);
  }

  const studyUnits = [];
  const languagePlan = resolvePackLanguagePlan(manifest, content);
  const targetLangs = languagePlan.targetLangs;
  const sourceLangs = languagePlan.sourceLangs;
  const missingPairs = [];
  for (const concept of concepts) {
    const conceptId = concept.concept_id;
    if (concept.pos !== 'noun') {
      for (const targetLang of targetLangs) {
        const targetCoreForms =
          formsByConceptAndSlot.get(`${conceptId}|${targetLang}|core`) ?? [];
        for (const sourceLang of sourceLangs) {
          if (sourceLang === targetLang) {
            continue;
          }
          const sourceCoreForms =
            formsByConceptAndSlot.get(`${conceptId}|${sourceLang}|core`) ?? [];

          if (!sourceCoreForms.length || !targetCoreForms.length) {
            missingPairs.push({
              concept_id: conceptId,
              source_lang: sourceLang,
              target_lang: targetLang,
              slot_key: 'core',
            });
            continue;
          }

          const primarySource = choosePrimaryForm(sourceCoreForms);
          const primaryExpected = choosePrimaryForm(targetCoreForms);
          const extraExpectedIds = targetCoreForms
            .filter((entry) => entry.row.form_id !== primaryExpected.row.form_id)
            .map((entry) => entry.row.form_id);
          const primaryReciprocal = choosePrimaryForm(sourceCoreForms);
          const reciprocalExtraIds = sourceCoreForms
            .filter((entry) => entry.row.form_id !== primaryReciprocal.row.form_id)
            .map((entry) => entry.row.form_id);

          studyUnits.push(
            createStudyUnitRow({
              packId,
              conceptId,
              sourceLang,
              targetLang,
              unitKind: 'core_prod',
              sourceFormId: primarySource.row.form_id,
              primaryExpectedFormId: primaryExpected.row.form_id,
              extraExpectedFormIds: extraExpectedIds,
              grammarTags: [],
              isCore: true,
              promptStyle: 'translate',
              slotKey: 'core',
            }),
          );
          studyUnits.push(
            createStudyUnitRow({
              packId,
              conceptId,
              sourceLang: targetLang,
              targetLang: sourceLang,
              unitKind: 'core_rec',
              sourceFormId: primaryExpected.row.form_id,
              primaryExpectedFormId: primaryReciprocal.row.form_id,
              extraExpectedFormIds: reciprocalExtraIds,
              grammarTags: [],
              isCore: true,
              promptStyle: 'translate',
              slotKey: 'core',
            }),
          );
        }
      }
      continue;
    }

    for (const targetLang of targetLangs) {
      const targetNounMorphologyPlugin = getNounMorphologyPlugin(targetLang);
      if (!targetNounMorphologyPlugin) {
        continue;
      }
      const targetSingularForms =
        formsByConceptAndSlot.get(
          `${conceptId}|${targetLang}|${nounCoreSlotKeyForLanguage(targetLang, 'sg')}`,
        ) ?? [];
      const targetPluralForms =
        formsByConceptAndSlot.get(
          `${conceptId}|${targetLang}|${nounCoreSlotKeyForLanguage(targetLang, 'pl')}`,
        ) ?? [];

      for (const sourceLang of sourceLangs) {
        if (sourceLang === targetLang) {
          continue;
        }
        const sourceSingularForms =
          formsByConceptAndSlot.get(
            `${conceptId}|${sourceLang}|${nounCoreSlotKeyForLanguage(sourceLang, 'sg')}`,
          ) ?? [];
        const sourcePluralForms =
          formsByConceptAndSlot.get(
            `${conceptId}|${sourceLang}|${nounCoreSlotKeyForLanguage(sourceLang, 'pl')}`,
          ) ?? [];

        const buildPair = ({
          unitKind,
          sourceForms,
          expectedForms,
          slotKey,
          grammarTags = [],
          isCore,
          promptStyle,
          reciprocalTargetLang,
        }) => {
          if (!sourceForms.length || !expectedForms.length) {
            missingPairs.push({
              concept_id: conceptId,
              source_lang: sourceLang,
              target_lang: targetLang,
              slot_key: slotKey,
            });
            return;
          }

          const primarySource = choosePrimaryForm(sourceForms);
          const primaryExpected = choosePrimaryForm(expectedForms);
          const extraExpectedIds = expectedForms
            .filter((entry) => entry.row.form_id !== primaryExpected.row.form_id)
            .map((entry) => entry.row.form_id);
          const primaryReciprocal = choosePrimaryForm(sourceForms);
          const reciprocalExtraIds = sourceForms
            .filter((entry) => entry.row.form_id !== primaryReciprocal.row.form_id)
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
              extraExpectedFormIds: extraExpectedIds,
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
              sourceLang: reciprocalTargetLang,
              targetLang: sourceLang,
              unitKind: unitKind === 'core_prod' ? 'core_rec' : 'grammar_rec',
              sourceFormId: primaryExpected.row.form_id,
              primaryExpectedFormId: primaryReciprocal.row.form_id,
              extraExpectedFormIds: reciprocalExtraIds,
              grammarTags,
              isCore,
              promptStyle,
              slotKey,
            }),
          );
        };

        buildPair({
          unitKind: 'core_prod',
          sourceForms: sourceSingularForms,
          expectedForms: targetSingularForms,
          slotKey: 'sg_core',
          isCore: true,
          promptStyle: 'translate',
          reciprocalTargetLang: targetLang,
        });
        buildPair({
          unitKind: 'core_prod',
          sourceForms: sourcePluralForms,
          expectedForms: targetPluralForms,
          slotKey: 'pl_core',
          isCore: true,
          promptStyle: 'translate',
          reciprocalTargetLang: targetLang,
        });

        for (const pair of nounGrammarStudyPairsForLanguage(targetLang)) {
          buildPair({
            unitKind: 'grammar_prod',
            sourceForms:
              pair.sourceNumber === 'pl' ? sourcePluralForms : sourceSingularForms,
            expectedForms:
              formsByConceptAndSlot.get(
                `${conceptId}|${targetLang}|${pair.expectedSlotKey}`,
              ) ?? [],
            slotKey: pair.expectedSlotKey,
            grammarTags: pair.grammarTags,
            isCore: false,
            promptStyle: 'translate_with_grammar_tag',
            reciprocalTargetLang: targetLang,
          });
        }
      }
    }
  }

  content.lexemes = lexemes.map(stripAuthoringLexemeFields);
  delete content.concept_relations;
  delete content.glosses;
  delete content.gloss_aliases;
  content.concept_definitions = conceptDefinitions;
  content.lexeme_forms = forms;
  if (languagePlan.embedsStudyUnits) {
    content.study_units = studyUnits;
  } else {
    delete content.study_units;
  }
  manifest.schema_version = 2;

  const report = {
    pack_id: packId,
    version: manifest.version,
    schema_version: manifest.schema_version,
    source_pack_languages: isSourcePackManifest(manifest)
      ? {
          languages_present: languagePlan.languagesPresent,
        }
      : null,
    runtime_language_support: isSourcePackManifest(manifest)
      ? null
      : {
          languages_target_supported: targetLangs,
          gloss_languages_supported: sourceLangs,
        },
    noun_concepts: nounsTotal,
    non_noun_concepts: nonNounConceptsTotal,
    active_lexemes: lexemes.filter((row) => row.is_active !== false).length,
    deprecated_duplicate_lexemes: lexemes.filter(
      (row) => row.is_active === false && row.status === 'deprecated',
    ).length,
    lexeme_morphology_overrides: lexemeMorphologyOverrides.lexemeOverrides.size,
    non_noun_core_forms: nonNounCoreForms,
    morphology_metrics_by_lang: Object.fromEntries(
      [...nounPluralCoreFormsByLang.entries()].map(([lang, count]) => [
        lang,
        { noun_plural_core_forms: count },
      ]),
    ),
    lexeme_forms: forms.length,
    study_units: studyUnits.length,
    missing_pairs: missingPairs.length,
    missing_pairs_sample: missingPairs.slice(0, 20),
  };

  if (!options.dryRun) {
    writeJson(manifestPath, manifest);
    writeJson(contentPath, content);
  }

  console.log(JSON.stringify(report, null, 2));
}

main();

