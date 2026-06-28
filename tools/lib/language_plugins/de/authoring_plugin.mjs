// German authoring hooks for the drafter (authoring-time, language-specific).
//
// Build-time German morphology (forms, declension, ingest) lives in the sibling
// de/*_build_plugin / de/entry_ingest_plugin files and the build registry.
// This is the small AUTHORING seam the drafter needs: infer and validate the
// German-specific concept fields while a draft is being written - here, the concept
// gender, which German encodes in the citation article (der/die/das).

import { DE_ARTICLE_GENDER, asString } from '../../authoring_core.mjs';

const articleOf = (record) => asString(record.lexemes?.de?.text).trim().toLowerCase().split(' ')[0];

export const germanAuthoringPlugin = {
  languageCode: 'de',

  // Set the concept gender from the German citation article (der/die/das is authoritative).
  inferConcept(record) {
    const g = DE_ARTICLE_GENDER[articleOf(record)];
    if (g && record.concept) record.concept.gender = g;
  },

  // Flag a concept gender that contradicts the German article.
  validate(record) {
    const issues = [];
    const artGender = DE_ARTICLE_GENDER[articleOf(record)];
    const g = asString(record.concept?.gender).toLowerCase();
    if (artGender && g && g !== 'none' && g !== artGender) {
      issues.push(`gender "${g}" contradicts the de article ("${record.lexemes.de.text}" -> ${artGender})`);
    }
    return issues;
  },
};
