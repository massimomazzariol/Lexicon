const germanNounSlotDefinitions = [
  {
    slotKey: 'nom_sg_def',
    numberValue: 'sg',
    grammaticalCase: 'nom',
    definiteness: 'def',
    formRole: 'core',
    grammarTags: [],
  },
  {
    slotKey: 'nom_pl_def',
    numberValue: 'pl',
    grammaticalCase: 'nom',
    definiteness: 'def',
    formRole: 'core',
    grammarTags: [],
    countsTowardPluralCoreMetric: true,
  },
  {
    slotKey: 'acc_sg_def',
    numberValue: 'sg',
    grammaticalCase: 'acc',
    definiteness: 'def',
    formRole: 'extended',
    grammarTags: ['accusative', 'singular'],
  },
  {
    slotKey: 'dat_sg_def',
    numberValue: 'sg',
    grammaticalCase: 'dat',
    definiteness: 'def',
    formRole: 'extended',
    grammarTags: ['dative', 'singular'],
  },
  {
    slotKey: 'gen_sg_def',
    numberValue: 'sg',
    grammaticalCase: 'gen',
    definiteness: 'def',
    formRole: 'extended',
    grammarTags: ['genitive', 'singular'],
  },
  {
    slotKey: 'dat_pl_def',
    numberValue: 'pl',
    grammaticalCase: 'dat',
    definiteness: 'def',
    formRole: 'extended',
    grammarTags: ['dative', 'plural'],
  },
];

const germanGrammarStudyPairs = [
  {
    expectedSlotKey: 'acc_sg_def',
    sourceNumber: 'sg',
    grammarTags: ['accusative', 'singular'],
  },
  {
    expectedSlotKey: 'dat_sg_def',
    sourceNumber: 'sg',
    grammarTags: ['dative', 'singular'],
  },
  {
    expectedSlotKey: 'gen_sg_def',
    sourceNumber: 'sg',
    grammarTags: ['genitive', 'singular'],
  },
  {
    expectedSlotKey: 'dat_pl_def',
    sourceNumber: 'pl',
    grammarTags: ['dative', 'plural'],
  },
];

const germanKnownArticles = new Set([
  'der',
  'die',
  'das',
  'dem',
  'den',
  'des',
  'ein',
  'eine',
  'einen',
  'einem',
  'einer',
  'eines',
]);

function germanArticleFor(gender, grammaticalCase, numberValue) {
  if (numberValue === 'pl') {
    return {
      nom: 'die',
      acc: 'die',
      dat: 'den',
      gen: 'der',
    }[grammaticalCase];
  }

  const articles = {
    masc: { nom: 'der', acc: 'den', dat: 'dem', gen: 'des' },
    fem: { nom: 'die', acc: 'die', dat: 'der', gen: 'der' },
    neut: { nom: 'das', acc: 'das', dat: 'dem', gen: 'des' },
  };
  return articles[gender]?.[grammaticalCase] ?? null;
}

function germanHasKnownArticle(value, helpers) {
  const token = helpers.normalizeLang(value).split(' ')[0];
  return germanKnownArticles.has(token);
}

function germanApplyNDeclension(noun) {
  if (noun.endsWith('en') || noun.endsWith('n')) return noun;
  if (noun.endsWith('e')) return `${noun}n`;
  return `${noun}en`;
}

function germanApplyGenitiveSuffix(noun) {
  const lower = noun.toLowerCase();
  if (
    lower.endsWith('s') ||
    lower.endsWith('\u00df') ||
    lower.endsWith('x') ||
    lower.endsWith('z') ||
    lower.endsWith('tz') ||
    lower.endsWith('sch')
  ) {
    return `${noun}es`;
  }
  return `${noun}s`;
}

function germanApplyDativePlural(noun, addN) {
  if (!addN) return noun;
  const lower = noun.toLowerCase();
  if (lower.endsWith('n') || lower.endsWith('s')) return noun;
  return `${noun}n`;
}

function germanOverrideKey(slotKey) {
  return slotKey.replace(/_def$/, '');
}

function normalizeGermanLexemeGender(lexeme, helpers) {
  const directGender = helpers.normalizeGender(lexeme?.gender);
  if (directGender !== 'none') {
    return directGender;
  }
  const fromArticleField = helpers.normalizeGender(lexeme?.article_nom_sg_def);
  if (fromArticleField !== 'none') {
    return fromArticleField;
  }
  // Last resort: the definite article carried in the surface text ("die
  // Fähigkeit" → fem). Draft-promoted nouns keep the article in the text but set
  // no gender field; der/die/das map unambiguously, so this is extraction, not a
  // guess, and lets such nouns be declined instead of shipping formless.
  const leadToken = helpers.normalizeText(lexeme?.text).split(/\s+/)[0];
  return helpers.normalizeGender(leadToken);
}

function normalizeGermanCaseOverrides(lexeme, helpers) {
  return helpers.pickObject(
    lexeme?.case_overrides_json ?? lexeme?.case_overrides,
  );
}

function normalizeGermanPluralSurface(lexeme, helpers) {
  return helpers.stripLeadingArticle(
    helpers.normalizeOptional(lexeme?.plural) ?? '',
    'de',
  );
}

function canGenerateGermanPlural(lexeme, helpers) {
  const plural = normalizeGermanPluralSurface(lexeme, helpers);
  const lemma = helpers.stripLeadingArticle(lexeme.lemma ?? lexeme.text, 'de');
  if (!plural || !lemma) {
    return false;
  }
  return plural.toLowerCase() !== lemma.toLowerCase();
}

function deriveGermanSurface({ lemma, lexeme, slot, helpers }) {
  const cleanedLemma = helpers.stripLeadingArticle(lemma, 'de');
  if (!cleanedLemma) {
    return null;
  }

  const overrides = normalizeGermanCaseOverrides(lexeme, helpers);
  const override = helpers.normalizeOptional(overrides[germanOverrideKey(slot.slotKey)]);
  const gender = normalizeGermanLexemeGender(lexeme, helpers);
  const article = germanArticleFor(
    gender,
    slot.grammaticalCase,
    slot.numberValue,
  );
  if (!article) {
    return null;
  }

  if (override) {
    if (germanHasKnownArticle(override, helpers)) {
      return helpers.normalizeText(override);
    }
    return helpers.normalizeText(`${article} ${override}`);
  }

  let noun =
    slot.numberValue === 'pl'
      ? normalizeGermanPluralSurface(lexeme, helpers)
      : cleanedLemma;
  if (!noun) {
    return null;
  }

  const nDeclension = helpers.isTruthy(lexeme?.n_declension);
  const pluralAddsNInDative =
    lexeme?.plural_adds_n_in_dative === false ? false : true;

  if (slot.numberValue === 'sg') {
    if (
      nDeclension &&
      (slot.grammaticalCase === 'acc' ||
        slot.grammaticalCase === 'dat' ||
        slot.grammaticalCase === 'gen')
    ) {
      noun = germanApplyNDeclension(noun);
    }
    if (
      slot.grammaticalCase === 'gen' &&
      gender !== 'fem' &&
      !nDeclension
    ) {
      noun = germanApplyGenitiveSuffix(noun);
    }
  } else if (slot.grammaticalCase === 'dat') {
    noun = germanApplyDativePlural(noun, pluralAddsNInDative);
  }

  return helpers.normalizeText(`${article} ${noun}`);
}

export const germanNounBuildPlugin = {
  slotDefinitions: germanNounSlotDefinitions,
  grammarStudyPairs: germanGrammarStudyPairs,
  pluginSource: 'language-plugin:de:noun-morphology',
  inferExistingSlotKey({ numberValue, grammaticalCase, definiteness }) {
    if (grammaticalCase === 'nom' && numberValue === 'sg' && definiteness === 'def') {
      return 'nom_sg_def';
    }
    if (grammaticalCase === 'nom' && numberValue === 'pl' && definiteness === 'def') {
      return 'nom_pl_def';
    }
    if (grammaticalCase === 'acc' && numberValue === 'sg' && definiteness === 'def') {
      return 'acc_sg_def';
    }
    if (grammaticalCase === 'dat' && numberValue === 'sg' && definiteness === 'def') {
      return 'dat_sg_def';
    }
    if (grammaticalCase === 'gen' && numberValue === 'sg' && definiteness === 'def') {
      return 'gen_sg_def';
    }
    if (grammaticalCase === 'dat' && numberValue === 'pl' && definiteness === 'def') {
      return 'dat_pl_def';
    }
    return null;
  },
  normalizeLexemeGender(lexeme, helpers) {
    return normalizeGermanLexemeGender(lexeme, helpers);
  },
  normalizeCaseOverrides(lexeme, helpers) {
    return normalizeGermanCaseOverrides(lexeme, helpers);
  },
  supportsLexeme(lexeme, helpers) {
    return ['masc', 'fem', 'neut'].includes(
      normalizeGermanLexemeGender(lexeme, helpers),
    );
  },
  shouldEmitSlot({ lexeme, slot, existingSurface, helpers }) {
    if (
      slot.slotKey.endsWith('_pl_def') &&
      !existingSurface &&
      !canGenerateGermanPlural(lexeme, helpers)
    ) {
      return false;
    }
    return true;
  },
  deriveSurface({ lemma, lexeme, slot, helpers }) {
    return deriveGermanSurface({ lemma, lexeme, slot, helpers });
  },
  coreSlotKeyForNumber(numberValue) {
    return numberValue === 'pl' ? 'nom_pl_def' : 'nom_sg_def';
  },
};
