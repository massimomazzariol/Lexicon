function normalizeGermanCaseOverrides(translation) {
  if (
    translation?.case_overrides &&
    typeof translation.case_overrides === 'object'
  ) {
    return { ...translation.case_overrides };
  }
  if (translation?.caseOverrides && typeof translation.caseOverrides === 'object') {
    return { ...translation.caseOverrides };
  }
  return null;
}

export const germanEntryIngestPlugin = {
  languageCode: 'de',
  parseTranslation({ raw, helpers }) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    return {
      articleNomSgDef: helpers.normalizeOptional(
        raw.article_nom_sg_def ?? raw.article ?? raw.articleNomSgDef,
      ),
      gender: helpers.normalizeOptional(raw.gender),
      plural: helpers.normalizeOptional(raw.plural),
      nDeclension: raw.n_declension === true || raw.nDeclension === true,
      pluralAddsNInDative:
        raw.plural_adds_n_in_dative === false ||
        raw.pluralAddsNInDative === false
          ? false
          : true,
      caseOverrides: normalizeGermanCaseOverrides(raw),
    };
  },
  buildLexemePatch({ parsedTranslation, existingLexeme, pos, helpers }) {
    if (pos !== 'noun') {
      return {};
    }

    const ingestData =
      parsedTranslation?.entryIngestData &&
      typeof parsedTranslation.entryIngestData === 'object'
        ? parsedTranslation.entryIngestData
        : {};
    const existingCaseOverrides =
      existingLexeme?.case_overrides_json &&
      typeof existingLexeme.case_overrides_json === 'object'
        ? { ...existingLexeme.case_overrides_json }
        : {};
    const mergedCaseOverrides =
      ingestData.caseOverrides == null
        ? existingCaseOverrides
        : {
            ...existingCaseOverrides,
            ...ingestData.caseOverrides,
          };

    const patch = {
      gender:
        helpers.normalizeGender(ingestData.gender) ??
        helpers.normalizeGender(existingLexeme?.gender) ??
        existingLexeme?.gender ??
        null,
      article_nom_sg_def:
        ingestData.articleNomSgDef ??
        helpers.normalizeOptional(existingLexeme?.article_nom_sg_def),
      plural:
        ingestData.plural ?? helpers.normalizeOptional(existingLexeme?.plural),
      n_declension:
        ingestData.nDeclension === true || existingLexeme?.n_declension === true,
      plural_adds_n_in_dative:
        ingestData.pluralAddsNInDative === false ||
        existingLexeme?.plural_adds_n_in_dative === false
          ? false
          : true,
    };

    if (Object.keys(mergedCaseOverrides).length > 0) {
      patch.case_overrides_json = mergedCaseOverrides;
    }

    return patch;
  },
};
