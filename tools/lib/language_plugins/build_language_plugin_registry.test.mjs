import assert from 'node:assert/strict';
import test from 'node:test';

import { LEXICON_LEVELS } from '../lexicon_conventions.mjs';
import { BUILD_LANGUAGE_PLUGIN_CAPABILITIES } from './build_language_plugin_capabilities.mjs';
import {
  buildLanguageSupportsCapability,
  getBuildLanguagePlugin,
  getBuildLanguagePluginCapabilitiesForLanguage,
  getBuildLanguagePluginSummary,
  getEntryIngestPlugin,
  getMissingBuildLanguageCapabilitiesForLanguage,
  getMetadataCurationPlugin,
  getNounMorphologyPlugin,
  listBuildLanguagePlugins,
  listBuildLanguagePluginSummaries,
  listMetadataCurationPlugins,
} from './build_language_plugin_registry.mjs';

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeOptional(value) {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

function normalizeLang(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeGender(rawGender) {
  const normalized = normalizeLang(rawGender);
  if (['m', 'masc', 'masculine', 'der'].includes(normalized)) return 'masc';
  if (['f', 'fem', 'feminine', 'die'].includes(normalized)) return 'fem';
  if (['n', 'neut', 'neuter', 'das'].includes(normalized)) return 'neut';
  if (normalized === 'common') return 'common';
  return 'none';
}

function pickObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function stripLeadingArticle(text, lang) {
  const normalized = normalizeText(text);
  if (!normalized) return normalized;

  const lower = normalized.toLowerCase();
  const prefixesByLang = {
    de: [
      'der ',
      'die ',
      'das ',
      'dem ',
      'den ',
      'des ',
      'ein ',
      'eine ',
      'einen ',
      'einem ',
      'einer ',
      'eines ',
    ],
  };

  for (const prefix of prefixesByLang[lang] ?? []) {
    if (lower.startsWith(prefix)) {
      return normalized.slice(prefix.length).trim();
    }
  }
  return normalized;
}

function isTruthy(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = normalizeLang(value);
  return normalized === 'true' || normalized === '1';
}

const helpers = {
  isTruthy,
  normalizeGender,
  normalizeLang,
  normalizeOptional,
  normalizeText,
  pickObject,
  stripLeadingArticle,
};

function normalizeSearchKey(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00df|\u1e9e/g, 'ss')
    .toLowerCase();
}

function uniqueList(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function titleCaseDomain(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'daily') return 'Daily';
  if (normalized === 'social') return 'Social';
  if (normalized === 'travel') return 'Travel';
  return value;
}

test('build language plugin registry exposes the German noun plugin', () => {
  const plugin = getBuildLanguagePlugin('de');
  assert.ok(plugin);
  assert.equal(plugin.languageCode, 'de');
  assert.ok(listBuildLanguagePlugins().some((entry) => entry.languageCode === 'de'));
  assert.ok(getEntryIngestPlugin('de'));
  assert.deepEqual(getBuildLanguagePluginCapabilitiesForLanguage('de'), [
    BUILD_LANGUAGE_PLUGIN_CAPABILITIES.entryIngest,
    BUILD_LANGUAGE_PLUGIN_CAPABILITIES.metadataCuration,
    BUILD_LANGUAGE_PLUGIN_CAPABILITIES.nounMorphology,
    BUILD_LANGUAGE_PLUGIN_CAPABILITIES.verbMorphology,
    BUILD_LANGUAGE_PLUGIN_CAPABILITIES.runtimeGrammarPairs,
    BUILD_LANGUAGE_PLUGIN_CAPABILITIES.runtimeNounSlots,
    BUILD_LANGUAGE_PLUGIN_CAPABILITIES.sourceNounGeneration,
  ]);
});

test('build language plugin registry exposes the Italian noun runtime plugin', () => {
  const plugin = getBuildLanguagePlugin('it');
  assert.ok(plugin);
  assert.equal(plugin.languageCode, 'it');
  assert.ok(getNounMorphologyPlugin('it'));
  assert.equal(getEntryIngestPlugin('it'), null);
  assert.deepEqual(getBuildLanguagePluginCapabilitiesForLanguage('it'), [
    BUILD_LANGUAGE_PLUGIN_CAPABILITIES.nounMorphology,
    BUILD_LANGUAGE_PLUGIN_CAPABILITIES.runtimeGrammarPairs,
    BUILD_LANGUAGE_PLUGIN_CAPABILITIES.runtimeNounSlots,
  ]);
});

test('build language plugin registry exposes summaries and missing-capability checks', () => {
  const summaries = listBuildLanguagePluginSummaries();
  assert.deepEqual(
    summaries.map((summary) => summary.languageCode),
    ['de', 'it'],
  );

  assert.deepEqual(getBuildLanguagePluginSummary('de'), {
    languageCode: 'de',
    capabilities: [
      BUILD_LANGUAGE_PLUGIN_CAPABILITIES.entryIngest,
      BUILD_LANGUAGE_PLUGIN_CAPABILITIES.metadataCuration,
      BUILD_LANGUAGE_PLUGIN_CAPABILITIES.nounMorphology,
      BUILD_LANGUAGE_PLUGIN_CAPABILITIES.verbMorphology,
      BUILD_LANGUAGE_PLUGIN_CAPABILITIES.runtimeGrammarPairs,
      BUILD_LANGUAGE_PLUGIN_CAPABILITIES.runtimeNounSlots,
      BUILD_LANGUAGE_PLUGIN_CAPABILITIES.sourceNounGeneration,
    ],
  });

  assert.equal(
    buildLanguageSupportsCapability(
      'it',
      BUILD_LANGUAGE_PLUGIN_CAPABILITIES.runtimeGrammarPairs,
    ),
    true,
  );
  assert.deepEqual(
    getMissingBuildLanguageCapabilitiesForLanguage('it', [
      BUILD_LANGUAGE_PLUGIN_CAPABILITIES.nounMorphology,
      BUILD_LANGUAGE_PLUGIN_CAPABILITIES.entryIngest,
    ]),
    [BUILD_LANGUAGE_PLUGIN_CAPABILITIES.entryIngest],
  );
});

test('German noun build plugin derives inflected forms outside the core generator', () => {
  const plugin = getNounMorphologyPlugin('de');
  assert.ok(plugin);
  assert.equal(plugin.coreSlotKeyForNumber('sg'), 'nom_sg_def');
  assert.equal(plugin.coreSlotKeyForNumber('pl'), 'nom_pl_def');

  const datPlSlot = plugin.slotDefinitions.find(
    (slot) => slot.slotKey === 'dat_pl_def',
  );
  assert.ok(datPlSlot);

  const surface = plugin.deriveSurface({
    lemma: 'Hund',
    lexeme: {
      text: 'der Hund',
      lemma: 'Hund',
      gender: 'm',
      plural: 'Hunde',
      n_declension: false,
      plural_adds_n_in_dative: true,
      case_overrides_json: {},
    },
    slot: datPlSlot,
    helpers,
  });

  assert.equal(surface, 'den Hunden');
  assert.equal(
    plugin.inferExistingSlotKey({
      numberValue: 'dat',
      grammaticalCase: 'dat',
      definiteness: 'def',
    }),
    null,
  );
  assert.equal(
    plugin.inferExistingSlotKey({
      numberValue: 'pl',
      grammaticalCase: 'dat',
      definiteness: 'def',
    }),
    'dat_pl_def',
  );
});

test('Italian noun build plugin exposes runtime grammar pairs without taking over source generation', () => {
  const plugin = getNounMorphologyPlugin('it');
  assert.ok(plugin);
  assert.equal(plugin.applyToSourceGeneration, false);
  assert.equal(plugin.coreSlotKeyForNumber('sg'), 'sg_core');
  assert.equal(plugin.coreSlotKeyForNumber('pl'), 'pl_core');
  assert.deepEqual(plugin.grammarStudyPairs, [
    {
      expectedSlotKey: 'sg_core',
      sourceNumber: 'sg',
      grammarTags: ['singular'],
    },
    {
      expectedSlotKey: 'pl_core',
      sourceNumber: 'pl',
      grammarTags: ['plural'],
    },
  ]);
  assert.equal(
    plugin.inferExistingSlotKey({
      numberValue: 'sg',
      grammaticalCase: 'none',
      definiteness: 'def',
    }),
    'sg_core',
  );
  assert.equal(
    plugin.inferExistingSlotKey({
      numberValue: 'pl',
      grammaticalCase: 'none',
      definiteness: 'def',
    }),
    'pl_core',
  );
});

test('German metadata curation plugin applies source metadata outside the core curator', () => {
  const plugin = getMetadataCurationPlugin('de');
  assert.ok(plugin);
  assert.ok(
    listMetadataCurationPlugins().some(
      (entry) => entry.languageCode === 'de',
    ),
  );

  const content = {
    concepts: [
      {
        concept_id: 'concept-arrival',
        domain_tags: [],
        level_override: null,
      },
      {
        concept_id: 'concept-anything',
        domain_tags: [],
        level_override: null,
      },
    ],
    lexemes: [
      {
        lexeme_id: 'lexeme-arrival-de',
        concept_id: 'concept-arrival',
        lang: 'de',
        text: 'die Ankunft',
      },
      {
        lexeme_id: 'lexeme-anything-de',
        concept_id: 'concept-anything',
        lang: 'de',
        text: 'irgendetwas',
      },
    ],
  };

  const result = plugin.curateSourceMetadata({
    content,
    packId: 'lexicon.source',
    helpers: {
      normalizeKey: normalizeLang,
      normalizeSearchKey,
      normalizeText,
      titleCaseDomain,
      uniqueList,
      makeClusterId(label, type) {
        return `cluster:${type}:${label.toLowerCase()}`;
      },
    },
    levels: new Set(LEXICON_LEVELS),
  });

  assert.deepEqual(content.concepts[0].domain_tags, ['Travel']);
  assert.deepEqual(content.concepts[1].domain_tags, ['Daily']);
  assert.equal(content.concepts[1].level_override, 'A2');
  assert.ok(
    result.clusters.some((cluster) => cluster.label === 'travel movement'),
  );
  assert.ok(
    result.clusterMembers.some(
      (member) => member.lexeme_id === 'lexeme-arrival-de',
    ),
  );
  assert.ok(result.summary.unresolvedClusterMembers > 0);
});

test('German entry ingest plugin normalizes noun authoring fields outside the core upsert tool', () => {
  const plugin = getEntryIngestPlugin('de');
  assert.ok(plugin);

  const parsed = plugin.parseTranslation({
    raw: {
      article_nom_sg_def: 'der',
      gender: 'm',
      plural: 'Hunde',
      n_declension: false,
      plural_adds_n_in_dative: false,
      case_overrides: {
        dat_pl: 'Hunden',
      },
    },
    helpers: {
      normalizeOptional,
      normalizeText,
    },
  });

  const patch = plugin.buildLexemePatch({
    parsedTranslation: {
      text: 'Hund',
      entryIngestData: parsed,
    },
    existingLexeme: null,
    pos: 'noun',
    helpers,
  });

  assert.deepEqual(patch, {
    gender: 'masc',
    article_nom_sg_def: 'der',
    plural: 'Hunde',
    n_declension: false,
    plural_adds_n_in_dative: false,
    case_overrides_json: {
      dat_pl: 'Hunden',
    },
  });
});
