import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { handleCliHelp } from '../lib/cli_help.mjs';
import { normalizeDomainTags } from '../lib/content_taxonomy.mjs';
import { DEFAULT_SOURCE_PACK_DIR } from '../lib/default_pack_paths.mjs';
import {
  findFormattingOnlyDuplicates,
  languageRequiresArticlefulNounSurfaces,
} from '../lib/editorial_invariants.mjs';
import {
  DEFAULT_LEXICON_LEVEL,
  LEVEL_DIFFICULTY_MAP,
  normalizeLexiconLevel,
} from '../lib/lexicon_conventions.mjs';
import { inferSurfaceDefiniteness } from '../lib/language_text_conventions.mjs';
import { getEntryIngestPlugin } from '../lib/language_plugins/build_language_plugin_registry.mjs';

const DEFAULT_PACK_DIR = DEFAULT_SOURCE_PACK_DIR;
const validPos = new Set(['noun', 'verb', 'adj', 'adv', 'chunk']);
const HELP_TEXT = `
Usage:
  pnpm node tools/pipeline/upsert_pack_entries.mjs --entries <path-to-entries.json> [options]

Options:
  --pack-dir <dir>         Canonical source pack directory. Default: packs/lexicon_source
  --entries <file>         Editorial batch entries JSON to merge into the source pack
  --dry-run                Compute the update summary without rewriting files
  -h, --help               Show this help message
`;

function parseArgs(argv) {
  handleCliHelp(argv, HELP_TEXT);
  const options = {
    packDir: DEFAULT_PACK_DIR,
    entriesPath: '',
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--pack-dir') options.packDir = argv[++i];
    else if (arg === '--entries') options.entriesPath = argv[++i];
    else if (arg === '--dry-run') options.dryRun = true;
  }

  if (!options.entriesPath) {
    throw new Error('Missing --entries <path-to-entries.json>.');
  }

  return options;
}

function deterministicUuid(seed) {
  const hash = crypto.createHash('sha1').update(seed).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeOptional(value) {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

function normalizeLevel(value) {
  return normalizeLexiconLevel(value);
}

function normalizePos(value) {
  const normalized = normalizeText(value).toLowerCase();
  return validPos.has(normalized) ? normalized : 'chunk';
}

function parseStringList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeOptional(entry))
      .filter(Boolean);
  }
  const one = normalizeOptional(value);
  return one ? [one] : [];
}

function ensureArray(root, key) {
  if (!Array.isArray(root[key])) {
    root[key] = [];
  }
  return root[key];
}

function mergeUniqueStrings(primary = [], secondary = []) {
  const output = [];
  const seen = new Set();
  for (const value of [...primary, ...secondary]) {
    const normalized = normalizeOptional(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function parseTranslation(raw, lang) {
  if (typeof raw === 'string') {
    return {
      text: normalizeOptional(raw),
      lemma: null,
      aliases: [],
      examples: [],
      definition: null,
      usageNote: null,
      contextTags: [],
      cardSynonyms: [],
      cardAntonyms: [],
      hintText: null,
      antonymPolicy: null,
      countability: null,
      register: null,
      meaningStatus: null,
      isPrimary: null,
      status: null,
      isActive: null,
      lexemeNotes: null,
      entryIngestData: null,
      lexemeId: null,
    };
  }

  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const aliases = mergeUniqueStrings(raw.aliases, raw.synonyms);
  const entryIngestPlugin = getEntryIngestPlugin(lang);

  return {
    text: normalizeOptional(raw.text),
    lemma: normalizeOptional(raw.lemma),
    aliases,
    examples: Array.isArray(raw.examples) ? raw.examples : [],
    definition: normalizeOptional(raw.definition),
    usageNote: normalizeOptional(raw.usage_note ?? raw.usageNote),
    contextTags: parseStringList(raw.context_tags ?? raw.contextTags),
    cardSynonyms: parseStringList(raw.card_synonyms ?? raw.cardSynonyms),
    cardAntonyms: parseStringList(raw.card_antonyms ?? raw.cardAntonyms),
    hintText: normalizeOptional(raw.hint_text ?? raw.hintText ?? raw.hint),
    antonymPolicy:
      raw.antonym_policy && typeof raw.antonym_policy === 'object'
        ? { ...raw.antonym_policy }
        : raw.antonyms_policy && typeof raw.antonyms_policy === 'object'
        ? { ...raw.antonyms_policy }
        : null,
    countability: normalizeOptional(raw.countability),
    register: normalizeOptional(raw.register),
    meaningStatus: normalizeOptional(raw.meaning_status ?? raw.meaningStatus),
    isPrimary:
      typeof raw.is_primary === 'boolean'
        ? raw.is_primary
        : typeof raw.isPrimary === 'boolean'
        ? raw.isPrimary
        : null,
    status: normalizeOptional(raw.status),
    isActive:
      typeof raw.is_active === 'boolean'
        ? raw.is_active
        : typeof raw.isActive === 'boolean'
        ? raw.isActive
        : null,
    lexemeNotes: normalizeOptional(raw.notes),
    entryIngestData:
      entryIngestPlugin?.parseTranslation?.({
        raw,
        helpers: {
          normalizeOptional,
          normalizeText,
        },
      }) ?? null,
    lexemeId: normalizeOptional(raw.lexeme_id ?? raw.lexemeId),
  };
}

function normalizeGender(genderRaw) {
  const value = normalizeText(genderRaw).toLowerCase();
  if (['m', 'masc', 'masculine'].includes(value)) return 'masc';
  if (['f', 'fem', 'feminine'].includes(value)) return 'fem';
  if (['n', 'neut', 'neuter'].includes(value)) return 'neut';
  if (value === 'common') return 'common';
  if (value === 'none') return 'none';
  return null;
}

function buildEntryIngestHelpers() {
  return {
    normalizeGender,
    normalizeOptional,
    normalizeText,
  };
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function upsertByPredicate(array, predicate, row) {
  const index = array.findIndex(predicate);
  if (index >= 0) {
    array[index] = row;
    return { updated: true };
  }
  array.push(row);
  return { updated: false };
}

function assertTranslationEditorialInvariants({
  sourceKey,
  lang,
  pos,
  parsedTranslation,
}) {
  const requiresArticlefulSourceSurface =
    pos === 'noun' && languageRequiresArticlefulNounSurfaces(lang);

  if (
    requiresArticlefulSourceSurface &&
    inferSurfaceDefiniteness(parsedTranslation.text, lang) === 'bare'
  ) {
    throw new Error(
      `Entry ${sourceKey} ${lang} noun text must keep its article: "${parsedTranslation.text}".`,
    );
  }

  const offendingSupportValues = findFormattingOnlyDuplicates({
    canonicalSurface: parsedTranslation.text,
    candidates: mergeUniqueStrings(
      parsedTranslation.aliases,
      parsedTranslation.cardSynonyms,
    ),
    lang,
    pos,
  });
  if (offendingSupportValues.length > 0) {
    throw new Error(
      `Entry ${sourceKey} ${lang} ${pos} support values must not use formatting-only duplicates of "${parsedTranslation.text}": ${offendingSupportValues.join(', ')}.`,
    );
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packDir = path.resolve(options.packDir);
  const entriesPath = path.resolve(options.entriesPath);
  const manifestPath = path.join(packDir, 'manifest.json');
  const contentPath = path.join(packDir, 'content.json');

  const manifest = readJson(manifestPath);
  const content = readJson(contentPath);
  const entries = readJson(entriesPath);

  if (!Array.isArray(entries)) {
    throw new Error('Entries file must be a JSON array.');
  }

  const concepts = ensureArray(content, 'concepts');
  const lexemes = ensureArray(content, 'lexemes');
  const examples = ensureArray(content, 'examples');
  const conceptDefinitions = ensureArray(content, 'concept_definitions');
  delete content.glosses;
  delete content.gloss_aliases;

  let conceptCreated = 0;
  let conceptUpdated = 0;
  let lexemeCreated = 0;
  let lexemeUpdated = 0;
  let exampleCreated = 0;
  let conceptDefinitionCreated = 0;
  let conceptDefinitionUpdated = 0;

  for (const [entryIndex, rawEntry] of entries.entries()) {
    if (!rawEntry || typeof rawEntry !== 'object') {
      throw new Error(`Entry at index ${entryIndex} is not an object.`);
    }

    const pos = normalizePos(rawEntry.pos);
    const sourceKey =
      normalizeOptional(rawEntry.source_key) ??
      normalizeOptional(rawEntry.key) ??
      normalizeOptional(rawEntry.concept_id);
    if (!sourceKey) {
      throw new Error(
        `Entry at index ${entryIndex} requires source_key (or concept_id).`,
      );
    }

    const conceptId =
      normalizeOptional(rawEntry.concept_id) ??
      deterministicUuid(`concept:${sourceKey.toLowerCase()}:${pos}`);
    const existingConcept =
      concepts.find((row) => row.concept_id === conceptId) ?? null;
    const hasLevelAuto = Object.hasOwn(rawEntry, 'level_auto');
    const hasLevelOverride = Object.hasOwn(rawEntry, 'level_override');
    const hasDifficulty = Object.hasOwn(rawEntry, 'difficulty_score_auto');
    const hasDomainTags = Object.hasOwn(rawEntry, 'domain_tags');
    const hasNotes = Object.hasOwn(rawEntry, 'notes');
    const hasMetadata = Object.hasOwn(rawEntry, 'metadata_json');
    const parsedLevelAuto = normalizeLevel(rawEntry.level_auto);
    const levelAuto =
      (hasLevelAuto ? parsedLevelAuto : null) ??
      normalizeLevel(existingConcept?.level_auto) ??
      DEFAULT_LEXICON_LEVEL;
    const parsedLevelOverride = normalizeLevel(rawEntry.level_override);
    const levelOverride = hasLevelOverride
      ? parsedLevelOverride
      : normalizeLevel(existingConcept?.level_override);
    const difficultyAuto = hasDifficulty && Number.isFinite(rawEntry.difficulty_score_auto)
      ? Math.max(0, Math.min(100, Number(rawEntry.difficulty_score_auto)))
      : Number.isFinite(existingConcept?.difficulty_score_auto)
      ? Math.max(0, Math.min(100, Number(existingConcept.difficulty_score_auto)))
      : LEVEL_DIFFICULTY_MAP[levelAuto];
    const domainTags = hasDomainTags
      ? normalizeDomainTags(rawEntry.domain_tags, { fallback: ['Daily'] })
      : normalizeDomainTags(existingConcept?.domain_tags, {
          fallback: ['Daily'],
        });
    const notes = hasNotes
      ? normalizeOptional(rawEntry.notes)
      : normalizeOptional(existingConcept?.notes);
    const existingMetadata =
      existingConcept?.metadata_json &&
      typeof existingConcept.metadata_json === 'object' &&
      !Array.isArray(existingConcept.metadata_json)
        ? { ...existingConcept.metadata_json }
        : {};
    const metadata = hasMetadata
      ? rawEntry.metadata_json &&
        typeof rawEntry.metadata_json === 'object' &&
        !Array.isArray(rawEntry.metadata_json)
        ? {
            ...existingMetadata,
            ...rawEntry.metadata_json,
          }
        : {}
      : existingMetadata;

    const conceptResult = upsertByPredicate(
      concepts,
      (row) => row.concept_id === conceptId,
      {
        concept_id: conceptId,
        pos,
        difficulty_score_auto: difficultyAuto,
        level_auto: levelAuto,
        level_override: levelOverride,
        domain_tags: domainTags,
        notes,
        metadata_json: metadata,
      },
    );
    if (conceptResult.updated) conceptUpdated += 1;
    else conceptCreated += 1;

    const translations = rawEntry.translations;
    if (!translations || typeof translations !== 'object') {
      throw new Error(
        `Entry ${sourceKey} must contain translations object (de/en/it...).`,
      );
    }

    for (const [langRaw, translationRaw] of Object.entries(translations)) {
      const lang = normalizeText(langRaw).toLowerCase();
      const parsed = parseTranslation(translationRaw, lang);
      if (!parsed || !parsed.text) continue;
      assertTranslationEditorialInvariants({
        sourceKey,
        lang,
        pos,
        parsedTranslation: parsed,
      });

      const lexemeId =
        parsed.lexemeId ??
        deterministicUuid(
          `lexeme:${conceptId}:${lang}:${parsed.text.toLowerCase()}`,
        );
      const existingLexeme = lexemes.find((row) => row.lexeme_id === lexemeId);
      const entryIngestPlugin = getEntryIngestPlugin(lang);
      const pluginLexemePatch =
        entryIngestPlugin?.buildLexemePatch?.({
          parsedTranslation: parsed,
          existingLexeme,
          pos,
          helpers: buildEntryIngestHelpers(),
        }) ?? {};
      const conceptLangHasOtherLexeme = lexemes.some(
        (row) =>
          row.concept_id === conceptId &&
          row.lang === lang &&
          row.lexeme_id !== lexemeId,
      );

      const lexemeResult = upsertByPredicate(
        lexemes,
        (row) => row.lexeme_id === lexemeId,
        {
          ...(existingLexeme ?? {}),
          lexeme_id: lexemeId,
          concept_id: conceptId,
          lang,
          text: parsed.text,
          lemma:
            parsed.lemma ??
            existingLexeme?.lemma ??
            normalizeOptional(parsed.text) ??
            null,
          pos,
          gender: existingLexeme?.gender ?? null,
          frequency_rank:
            existingLexeme?.frequency_rank ?? rawEntry.frequency_rank ?? null,
          countability:
            parsed.countability ?? existingLexeme?.countability ?? 'none',
          register: parsed.register ?? existingLexeme?.register ?? 'neutral',
          meaning_status:
            parsed.meaningStatus ?? existingLexeme?.meaning_status ?? 'exact',
          is_primary:
            parsed.isPrimary ??
            existingLexeme?.is_primary ??
            !conceptLangHasOtherLexeme,
          status: parsed.status ?? existingLexeme?.status ?? 'approved',
          notes: parsed.lexemeNotes ?? existingLexeme?.notes ?? null,
          is_active: parsed.isActive ?? existingLexeme?.is_active ?? true,
          ...pluginLexemePatch,
        },
      );
      if (lexemeResult.updated) lexemeUpdated += 1;
      else lexemeCreated += 1;

      const existingDefinition =
        conceptDefinitions.find(
          (row) => row.concept_id === conceptId && row.lang === lang,
        ) ?? null;
      if (
        parsed.definition ||
        parsed.usageNote ||
        parsed.contextTags.length > 0 ||
        parsed.aliases.length > 0 ||
        parsed.cardSynonyms.length > 0 ||
        parsed.cardAntonyms.length > 0 ||
        parsed.hintText ||
        parsed.antonymPolicy ||
        existingDefinition
      ) {
        const definitionResult = upsertByPredicate(
          conceptDefinitions,
          (row) => row.concept_id === conceptId && row.lang === lang,
          {
            concept_id: conceptId,
            lang,
            short_definition:
              parsed.definition ?? existingDefinition?.short_definition ?? null,
            usage_note:
              parsed.usageNote ?? existingDefinition?.usage_note ?? null,
            context_tags_json:
              parsed.contextTags.length > 0
                ? parsed.contextTags
                : Array.isArray(existingDefinition?.context_tags_json)
                ? existingDefinition.context_tags_json
                : [],
            source: 'manual',
            synonyms_json: mergeUniqueStrings(
              Array.isArray(existingDefinition?.synonyms_json)
                ? existingDefinition.synonyms_json
                : [],
              mergeUniqueStrings(parsed.aliases, parsed.cardSynonyms),
            ),
            antonyms_json: mergeUniqueStrings(
              Array.isArray(existingDefinition?.antonyms_json)
                ? existingDefinition.antonyms_json
                : [],
              parsed.cardAntonyms,
            ),
            antonym_policy_json:
              parsed.antonymPolicy ??
              existingDefinition?.antonym_policy_json ??
              null,
            hint_text:
              parsed.hintText ?? existingDefinition?.hint_text ?? null,
          },
        );
        if (definitionResult.updated) conceptDefinitionUpdated += 1;
        else conceptDefinitionCreated += 1;
      }

      for (const rawExample of parsed.examples) {
        let sentence = null;
        let translationLang = null;
        let translationText = null;

        if (typeof rawExample === 'string') {
          sentence = normalizeOptional(rawExample);
        } else if (rawExample && typeof rawExample === 'object') {
          sentence = normalizeOptional(rawExample.sentence ?? rawExample.text);
          translationLang = normalizeOptional(rawExample.translation_lang);
          translationText = normalizeOptional(rawExample.translation_text);
        }

        if (!sentence) continue;
        const exampleId = deterministicUuid(
          `example:${conceptId}:${lang}:${sentence.toLowerCase()}`,
        );
        const exists = examples.some((row) => row.example_id === exampleId);
        if (exists) continue;
        examples.push({
          example_id: exampleId,
          concept_id: conceptId,
          lang,
          sentence,
          translation_lang: translationLang,
          translation_text: translationText,
        });
        exampleCreated += 1;
      }
    }
  }

  manifest.generated_at = new Date().toISOString();

  const summary = {
    concepts: { created: conceptCreated, updated: conceptUpdated },
    lexemes: { created: lexemeCreated, updated: lexemeUpdated },
    examples: { created: exampleCreated },
    conceptDefinitions: {
      created: conceptDefinitionCreated,
      updated: conceptDefinitionUpdated,
    },
    totals: {
      concepts: concepts.length,
      lexemes: lexemes.length,
      examples: examples.length,
      conceptDefinitions: conceptDefinitions.length,
    },
  };

  if (!options.dryRun) {
    writeJson(contentPath, content);
    writeJson(manifestPath, manifest);
  }

  console.log(
    `${options.dryRun ? 'DRY RUN' : 'UPDATED'} pack: ${path.relative(
      process.cwd(),
      packDir,
    )}`,
  );
  console.log(JSON.stringify(summary, null, 2));
}

main();

