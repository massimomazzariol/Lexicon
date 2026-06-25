export const BUILD_LANGUAGE_PLUGIN_CAPABILITIES = Object.freeze({
  entryIngest: 'entry_ingest',
  metadataCuration: 'metadata_curation',
  nounMorphology: 'noun_morphology',
  verbMorphology: 'verb_morphology',
  runtimeGrammarPairs: 'runtime_grammar_pairs',
  runtimeNounSlots: 'runtime_noun_slots',
  sourceNounGeneration: 'source_noun_generation',
});

const BUILD_LANGUAGE_PLUGIN_CAPABILITY_ORDER = Object.freeze(
  Object.values(BUILD_LANGUAGE_PLUGIN_CAPABILITIES),
);

function normalizeCapability(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeCapabilityList(values) {
  const out = [];
  const seen = new Set();
  for (const value of values ?? []) {
    const normalized = normalizeCapability(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out.sort((left, right) => {
    const leftIndex = BUILD_LANGUAGE_PLUGIN_CAPABILITY_ORDER.indexOf(left);
    const rightIndex = BUILD_LANGUAGE_PLUGIN_CAPABILITY_ORDER.indexOf(right);
    if (leftIndex === -1 && rightIndex === -1) {
      return left.localeCompare(right);
    }
    if (leftIndex === -1) {
      return 1;
    }
    if (rightIndex === -1) {
      return -1;
    }
    return leftIndex - rightIndex;
  });
}

function inferNounMorphologyCapabilities(nounMorphologyPlugin) {
  if (!nounMorphologyPlugin) {
    return [];
  }

  const capabilities = [BUILD_LANGUAGE_PLUGIN_CAPABILITIES.nounMorphology];

  if (
    typeof nounMorphologyPlugin.coreSlotKeyForNumber === 'function' ||
    typeof nounMorphologyPlugin.inferExistingSlotKey === 'function'
  ) {
    capabilities.push(BUILD_LANGUAGE_PLUGIN_CAPABILITIES.runtimeNounSlots);
  }

  if (
    Array.isArray(nounMorphologyPlugin.grammarStudyPairs) &&
    nounMorphologyPlugin.grammarStudyPairs.length > 0
  ) {
    capabilities.push(BUILD_LANGUAGE_PLUGIN_CAPABILITIES.runtimeGrammarPairs);
  }

  if (nounMorphologyPlugin.applyToSourceGeneration !== false) {
    capabilities.push(BUILD_LANGUAGE_PLUGIN_CAPABILITIES.sourceNounGeneration);
  }

  return capabilities;
}

export function getBuildLanguagePluginCapabilities(plugin) {
  if (!plugin || typeof plugin !== 'object') {
    return [];
  }

  const explicit = normalizeCapabilityList(plugin.capabilities);
  const inferred = [];

  if (plugin.entryIngest) {
    inferred.push(BUILD_LANGUAGE_PLUGIN_CAPABILITIES.entryIngest);
  }
  if (plugin.metadataCuration) {
    inferred.push(BUILD_LANGUAGE_PLUGIN_CAPABILITIES.metadataCuration);
  }
  if (plugin.verbMorphology) {
    inferred.push(BUILD_LANGUAGE_PLUGIN_CAPABILITIES.verbMorphology);
  }
  inferred.push(...inferNounMorphologyCapabilities(plugin.nounMorphology));

  return normalizeCapabilityList([...explicit, ...inferred]);
}

export function buildLanguagePluginSupportsCapability(plugin, capability) {
  const normalized = normalizeCapability(capability);
  if (!normalized) {
    return false;
  }
  return getBuildLanguagePluginCapabilities(plugin).includes(normalized);
}

export function getMissingBuildLanguageCapabilities(
  plugin,
  requiredCapabilities,
) {
  const declared = new Set(getBuildLanguagePluginCapabilities(plugin));
  return normalizeCapabilityList(requiredCapabilities).filter(
    (capability) => !declared.has(capability),
  );
}

export function summarizeBuildLanguagePlugin(plugin) {
  if (!plugin || typeof plugin !== 'object') {
    return null;
  }

  return {
    languageCode: String(plugin.languageCode ?? '').trim().toLowerCase(),
    capabilities: getBuildLanguagePluginCapabilities(plugin),
  };
}
