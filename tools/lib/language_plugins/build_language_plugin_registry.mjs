import { germanEntryIngestPlugin } from './de/entry_ingest_plugin.mjs';
import {
  buildLanguagePluginSupportsCapability,
  getBuildLanguagePluginCapabilities,
  getMissingBuildLanguageCapabilities,
  summarizeBuildLanguagePlugin,
} from './build_language_plugin_capabilities.mjs';
import { germanMetadataCurationPlugin } from './de/metadata_curation_plugin.mjs';
import { germanNounBuildPlugin } from './de/noun_build_plugin.mjs';
import { germanVerbBuildPlugin } from './de/verb_build_plugin.mjs';
import { italianNounBuildPlugin } from './it/noun_build_plugin.mjs';

const buildLanguagePlugins = [
  {
    languageCode: 'de',
    entryIngest: germanEntryIngestPlugin,
    nounMorphology: germanNounBuildPlugin,
    verbMorphology: germanVerbBuildPlugin,
    metadataCuration: germanMetadataCurationPlugin,
  },
  {
    languageCode: 'it',
    nounMorphology: italianNounBuildPlugin,
  },
];

const buildLanguagePluginRegistry = new Map(
  buildLanguagePlugins.map((plugin) => [plugin.languageCode, plugin]),
);

function normalizeLanguageCode(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function listBuildLanguagePlugins() {
  return [...buildLanguagePluginRegistry.values()];
}

export function listBuildLanguagePluginSummaries() {
  return listBuildLanguagePlugins()
    .map((plugin) => summarizeBuildLanguagePlugin(plugin))
    .filter(Boolean);
}

export function getBuildLanguagePlugin(languageCode) {
  return (
    buildLanguagePluginRegistry.get(normalizeLanguageCode(languageCode)) ?? null
  );
}

export function getBuildLanguagePluginSummary(languageCode) {
  return summarizeBuildLanguagePlugin(getBuildLanguagePlugin(languageCode));
}

export function getNounMorphologyPlugin(languageCode) {
  return getBuildLanguagePlugin(languageCode)?.nounMorphology ?? null;
}

export function getVerbMorphologyPlugin(languageCode) {
  return getBuildLanguagePlugin(languageCode)?.verbMorphology ?? null;
}

/** Generic accessor so the next language needs no new per-kind getter: kind = 'noun' | 'verb'. */
export function getMorphologyPlugin(languageCode, kind) {
  const plugin = getBuildLanguagePlugin(languageCode);
  if (!plugin) return null;
  if (kind === 'noun') return plugin.nounMorphology ?? null;
  if (kind === 'verb') return plugin.verbMorphology ?? null;
  return null;
}

export function getEntryIngestPlugin(languageCode) {
  return getBuildLanguagePlugin(languageCode)?.entryIngest ?? null;
}

export function getMetadataCurationPlugin(languageCode) {
  return getBuildLanguagePlugin(languageCode)?.metadataCuration ?? null;
}

export function listMetadataCurationPlugins() {
  return listBuildLanguagePlugins()
    .map((plugin) => plugin.metadataCuration)
    .filter(Boolean);
}

export function getBuildLanguagePluginCapabilitiesForLanguage(languageCode) {
  return getBuildLanguagePluginCapabilities(getBuildLanguagePlugin(languageCode));
}

export function buildLanguageSupportsCapability(languageCode, capability) {
  return buildLanguagePluginSupportsCapability(
    getBuildLanguagePlugin(languageCode),
    capability,
  );
}

export function getMissingBuildLanguageCapabilitiesForLanguage(
  languageCode,
  requiredCapabilities,
) {
  return getMissingBuildLanguageCapabilities(
    getBuildLanguagePlugin(languageCode),
    requiredCapabilities,
  );
}
