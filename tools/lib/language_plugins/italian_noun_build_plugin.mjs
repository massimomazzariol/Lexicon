const italianGrammarStudyPairs = [
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
];

export const italianNounBuildPlugin = {
  applyToSourceGeneration: false,
  slotDefinitions: [],
  grammarStudyPairs: italianGrammarStudyPairs,
  pluginSource: 'language-plugin:it:noun-morphology',
  inferExistingSlotKey({ numberValue, grammaticalCase }) {
    if (grammaticalCase !== 'none') {
      return null;
    }
    if (numberValue === 'sg') {
      return 'sg_core';
    }
    if (numberValue === 'pl') {
      return 'pl_core';
    }
    return null;
  },
  coreSlotKeyForNumber(numberValue) {
    return numberValue === 'pl' ? 'pl_core' : 'sg_core';
  },
};
