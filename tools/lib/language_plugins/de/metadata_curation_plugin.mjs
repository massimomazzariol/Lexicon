import { LEXICON_LEVELS } from '../../lexicon_conventions.mjs';

const germanBaseDomainByWord = {
  ankunft: ['Travel'],
  aussteigen: ['Travel'],
  ausflug: ['Travel'],
  aufzug: ['Travel'],
  abholen: ['Travel', 'Social'],
  anrufen: ['Social'],
  'kannst du mir helfen?': ['Social'],
  'hor mir zu': ['Social'],
  anrede: ['Social'],
  bewerbung: ['Social'],
  verheiratet: ['Social'],
  angebot: ['Social', 'Daily'],
  'ich verstehe nur bahnhof': ['Social'],
  aufstehen: ['Daily'],
  anfangen: ['Daily'],
  aufhoren: ['Daily'],
  bauen: ['Daily'],
  laufen: ['Daily'],
  lauf: ['Daily'],
  haus: ['Daily'],
  tisch: ['Daily'],
  bildschirm: ['Daily'],
  schicken: ['Daily', 'Social'],
  malen: ['Daily'],
  bedarf: ['Daily'],
  notwendigkeit: ['Daily'],
  uberraschung: ['Daily', 'Social'],
};

const germanLevelOverrideByWord = {
  lauf: 'A2',
  anrede: 'B2',
  derzeit: 'B2',
  notwendigkeit: 'B2',
  erwerben: 'B2',
  'ich verstehe nur bahnhof': 'B2',
  irgendetwas: 'A2',
  irgendjemand: 'A2',
  irgendwo: 'A2',
};

const germanClusterSpecs = [
  {
    label: 'ab-verb family',
    type: 'prefix_family',
    lang: 'de',
    members: ['abholen', 'abstimmen'],
  },
  {
    label: 'an-verb family',
    type: 'prefix_family',
    lang: 'de',
    members: ['anfangen', 'anrufen'],
  },
  {
    label: 'auf-verb family',
    type: 'prefix_family',
    lang: 'de',
    members: ['aufstehen', 'aufhoren'],
  },
  {
    label: 'irgend-forms',
    type: 'prefix_family',
    lang: 'de',
    members: ['irgendetwas', 'irgendjemand', 'irgendwo'],
  },
  {
    label: 'connector confusables',
    type: 'confusables',
    lang: 'de',
    members: [
      'deswegen',
      'trotzdem',
      'ebenfalls',
      'ansonsten',
      'eigentlich',
      'schliesslich',
      'am ende',
    ],
  },
  {
    label: 'value polarity',
    type: 'confusables',
    lang: 'de',
    members: ['wertvoll', 'wertlos'],
  },
  {
    label: 'travel movement',
    type: 'semantic',
    lang: 'de',
    members: ['ankunft', 'aussteigen', 'ausflug', 'abholen'],
  },
];

function germanHeadword(lexeme) {
  const lemma = String(lexeme?.lemma ?? '').trim();
  if (lemma) {
    return lemma;
  }
  return String(lexeme?.text ?? '')
    .replace(
      /^(der|die|das|dem|den|des|ein|eine|einen|einem|einer|eines)\s+/i,
      '',
    )
    .trim();
}

export const germanMetadataCurationPlugin = {
  languageCode: 'de',
  curateSourceMetadata({ content, helpers, levels }) {
    const allowedLevels =
      levels instanceof Set
        ? levels
        : new Set(LEXICON_LEVELS);
    const concepts = Array.isArray(content.concepts) ? content.concepts : [];
    const lexemes = Array.isArray(content.lexemes) ? content.lexemes : [];

    const germanLexemes = lexemes.filter(
      (row) => helpers.normalizeKey(row.lang) === 'de',
    );
    const germanLexemeByConcept = new Map();
    const germanLexemeByText = new Map();
    for (const lexeme of germanLexemes) {
      if (!germanLexemeByConcept.has(lexeme.concept_id)) {
        germanLexemeByConcept.set(lexeme.concept_id, lexeme);
      }
      germanLexemeByText.set(
        helpers.normalizeSearchKey(germanHeadword(lexeme)),
        lexeme,
      );
    }

    let conceptsWithDomainUpdates = 0;
    let conceptsWithLevelOverrideUpdates = 0;
    let conceptsDefaultedToDaily = 0;

    for (const concept of concepts) {
      const germanLexeme = germanLexemeByConcept.get(concept.concept_id);
      if (!germanLexeme) {
        continue;
      }

      const key = helpers.normalizeSearchKey(germanHeadword(germanLexeme));
      const mappedDomains = germanBaseDomainByWord[key];
      const existingDomains = Array.isArray(concept.domain_tags)
        ? concept.domain_tags
        : [];

      let nextDomains;
      if (mappedDomains && mappedDomains.length > 0) {
        nextDomains = helpers.uniqueList(
          mappedDomains.map(helpers.titleCaseDomain),
        );
      } else if (existingDomains.length > 0) {
        nextDomains = helpers.uniqueList(
          existingDomains.map(helpers.titleCaseDomain),
        );
      } else {
        nextDomains = ['Daily'];
        conceptsDefaultedToDaily += 1;
      }

      const currentDomainsKey = JSON.stringify(
        helpers.uniqueList(existingDomains.map(helpers.titleCaseDomain)),
      );
      const nextDomainsKey = JSON.stringify(nextDomains);
      if (currentDomainsKey !== nextDomainsKey) {
        concept.domain_tags = nextDomains;
        conceptsWithDomainUpdates += 1;
      }

      const override = germanLevelOverrideByWord[key] ?? null;
      const normalizedOverride =
        override && allowedLevels.has(override.toUpperCase())
          ? override.toUpperCase()
          : null;
      if ((concept.level_override ?? null) !== normalizedOverride) {
        concept.level_override = normalizedOverride;
        conceptsWithLevelOverrideUpdates += 1;
      }
    }

    const clusters = [];
    const clusterMembers = [];
    let unresolvedClusterMembers = 0;

    for (const spec of germanClusterSpecs) {
      const clusterId = helpers.makeClusterId(spec.label, spec.type);
      clusters.push({
        cluster_id: clusterId,
        lang: spec.lang,
        label: spec.label,
        type: spec.type,
      });

      let position = 0;
      for (const rawMember of spec.members) {
        const memberKey = helpers.normalizeSearchKey(rawMember);
        const lexeme = germanLexemeByText.get(memberKey);
        if (!lexeme) {
          unresolvedClusterMembers += 1;
          continue;
        }
        clusterMembers.push({
          cluster_id: clusterId,
          lexeme_id: lexeme.lexeme_id,
          position,
        });
        position += 1;
      }
    }

    return {
      clusters,
      clusterMembers,
      summary: {
        conceptsWithDomainUpdates,
        conceptsWithLevelOverrideUpdates,
        conceptsDefaultedToDaily,
        unresolvedClusterMembers,
      },
    };
  },
};
