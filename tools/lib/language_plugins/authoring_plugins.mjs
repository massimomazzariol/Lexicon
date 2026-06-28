// Authoring-time language plugins for the drafter, keyed by language code.
//
// Separate from the build-time plugin registry (build_language_plugin_registry): build
// plugins generate forms at pack-build time; these enrich and validate a draft record as
// it is authored. A language with no entry simply gets no authoring hooks (the drafter
// degrades to language-neutral behavior). To add language-specific authoring logic for a
// new language, write a `<lang>/authoring_plugin.mjs` and register it here.

import { germanAuthoringPlugin } from './de/authoring_plugin.mjs';

const registry = new Map([[germanAuthoringPlugin.languageCode, germanAuthoringPlugin]]);

/** Authoring plugin for a language code, or null if none is registered. */
export const getAuthoringPlugin = (languageCode) => registry.get(String(languageCode).toLowerCase()) ?? null;
