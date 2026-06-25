import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

function readJson(relativePath) {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'),
  );
}

function findEntry(entries, sourceKey) {
  return entries.find((entry) => entry.source_key === sourceKey);
}

function conceptTextsByLang(data, conceptId, lang) {
  return (data.lexemes || [])
    .filter((lexeme) => lexeme.concept_id === conceptId && lexeme.lang === lang)
    .map((lexeme) => lexeme.text);
}

test('reviewed semantic boundaries stay explicit in the source pack', () => {
  const data = readJson('packs/lexicon_source/content.json');

  const maleDoctorEnglish = conceptTextsByLang(
    data,
    'c8d6f640-caa6-df3b-b9c3-c57596e39817',
    'en',
  );
  assert.equal(maleDoctorEnglish.includes('doctor'), false);
  assert.equal(maleDoctorEnglish.includes('the doctor'), false);

  const maleDoctorItalian = conceptTextsByLang(
    data,
    'c8d6f640-caa6-df3b-b9c3-c57596e39817',
    'it',
  );
  assert.equal(
    maleDoctorItalian.filter((text) => text === 'il dottore').length,
    1,
  );
  assert.equal(maleDoctorItalian.includes('dottore'), false);

  const femaleDoctorEnglish = conceptTextsByLang(
    data,
    '009dc501-c851-823f-91ee-e332450407fd',
    'en',
  );
  assert.equal(femaleDoctorEnglish.includes('doctor'), false);
  assert.equal(femaleDoctorEnglish.includes('the doctor'), false);

  const illnessEnglish = conceptTextsByLang(
    data,
    'cf2250ea-ec5f-af07-513a-4fe7f5bd8752',
    'en',
  );
  assert.equal(illnessEnglish.includes('the disease'), false);

  const illnessItalian = conceptTextsByLang(
    data,
    'cf2250ea-ec5f-af07-513a-4fe7f5bd8752',
    'it',
  );
  assert.equal(illnessItalian.includes('il morbo'), false);

  assert.equal(
    conceptTextsByLang(data, '8419d673-418b-2599-16a4-4a6b56742191', 'it').includes(
      'la mattina',
    ),
    true,
  );
  assert.equal(
    conceptTextsByLang(data, '16aaee01-9bbf-1a30-7b7c-b135254c6510', 'it').includes(
      'la giornata',
    ),
    false,
  );
  assert.equal(
    conceptTextsByLang(data, 'ee083d9e-ea66-863b-b518-a3aef3d873d7', 'it').includes(
      'la nottata',
    ),
    false,
  );
  assert.equal(
    conceptTextsByLang(data, '87cacd30-b28b-2fc2-8d91-7e5dab5ae346', 'it').includes(
      'la serata',
    ),
    false,
  );
  assert.equal(
    conceptTextsByLang(data, '3ccd8f0b-5c40-e014-6e2d-6a092ffc9519', 'it').includes(
      "l'annata",
    ),
    false,
  );

  const kennenEnglish = conceptTextsByLang(
    data,
    'c5163d51-2abb-04e1-8ccf-36cb1fd312a9',
    'en',
  );
  assert.equal(kennenEnglish.includes('to know (a person/place)'), true);
  assert.equal(kennenEnglish.includes('to know'), true);
  assert.equal(kennenEnglish.includes('to be familiar with'), false);

  const kennenItalian = conceptTextsByLang(
    data,
    'c5163d51-2abb-04e1-8ccf-36cb1fd312a9',
    'it',
  );
  assert.equal(kennenItalian.includes('conoscere (persona o luogo)'), true);
  assert.equal(kennenItalian.includes('conoscere'), true);

  const wissenEnglish = conceptTextsByLang(
    data,
    'f8b7d1f2-7548-a134-db29-f44ff09d4c13',
    'en',
  );
  assert.equal(wissenEnglish.includes('to know'), true);

  const bauchEnglish = conceptTextsByLang(
    data,
    'a0faf9d1-ed1c-9f28-6d77-f8ebbb94f052',
    'en',
  );
  assert.equal(bauchEnglish.includes('the belly'), true);
  assert.equal(bauchEnglish.includes('the stomach'), false);

  const sitzenItalian = conceptTextsByLang(
    data,
    '87a180ff-f265-430e-bc0b-161b8604d068',
    'it',
  );
  assert.equal(sitzenItalian.includes('stare seduto'), true);
  assert.equal(sitzenItalian.includes('essere seduto'), true);
  assert.equal(sitzenItalian.includes('sedersi'), false);

  const ueberhauptNegativeGerman = conceptTextsByLang(
    data,
    'e26099e6-6292-9c2d-6b9a-69cf996ba8f7',
    'de',
  );
  assert.deepEqual(ueberhauptNegativeGerman, ['überhaupt']);

  const ueberhauptNegativeItalian = conceptTextsByLang(
    data,
    'e26099e6-6292-9c2d-6b9a-69cf996ba8f7',
    'it',
  );
  assert.equal(ueberhauptNegativeItalian.includes('per niente'), true);
  assert.equal(ueberhauptNegativeItalian.includes('affatto'), false);
  assert.equal(ueberhauptNegativeItalian.includes('in generale'), false);

  const ueberhauptNegativeEnglish = conceptTextsByLang(
    data,
    'e26099e6-6292-9c2d-6b9a-69cf996ba8f7',
    'en',
  );
  assert.equal(ueberhauptNegativeEnglish.includes('at all'), true);
  assert.equal(ueberhauptNegativeEnglish.includes('in general'), false);

  const ueberhauptGeneralEnglish = conceptTextsByLang(
    data,
    'concept-a2-ueberhaupt-general',
    'en',
  );
  assert.deepEqual(ueberhauptGeneralEnglish, ['in general']);

  const ueberhauptQuestionEnglish = conceptTextsByLang(
    data,
    'concept-a2-ueberhaupt-emphatic-question',
    'en',
  );
  assert.deepEqual(ueberhauptQuestionEnglish, ['even (in emphatic questions)']);

  const ueberhauptQuestionItalian = conceptTextsByLang(
    data,
    'concept-a2-ueberhaupt-emphatic-question',
    'it',
  );
  assert.deepEqual(ueberhauptQuestionItalian, ['poi (in domande enfatiche)']);
});

test('reviewed templates and support waves match the same semantic boundaries', () => {
  const ueberhauptWave = readJson('packs/templates/entries.a2_wave_ueberhaupt_split.json');
  const batch02 = readJson('packs/templates/entries.a1_curation_batch_02.json');
  const batch12 = readJson('packs/templates/entries.a1_curation_batch_12_verbs.json');
  const batch13 = readJson('packs/templates/entries.a1_curation_batch_13.json');
  const batch17 = readJson('packs/templates/entries.a1_curation_batch_17_family.json');
  const batch18 = readJson('packs/templates/entries.a1_curation_batch_18_travel.json');
  const healthEntries = readJson('packs/templates/entries.a1_curation_batch_20_health.json');
  const timeEntries = readJson('packs/templates/entries.a1_curation_batch_15_time.json');
  const supportWave01 = readJson('packs/templates/entries.a1_wave_answer_support_core_variants_01.json');
  const supportWave07 = readJson('packs/templates/entries.a1_wave_answer_support_core_variants_07.json');
  const supportWave11 = readJson('packs/templates/entries.a1_wave_answer_support_core_variants_11.json');

  const maleDoctor = findEntry(healthEntries, 'core_noun_arzt');
  assert.deepEqual(maleDoctor.translations.en.aliases, ['the physician']);
  assert.deepEqual(maleDoctor.translations.it.aliases, ['il dottore']);

  const femaleDoctor = findEntry(healthEntries, 'core_noun_aerztin');
  assert.equal(Object.hasOwn(femaleDoctor.translations.en, 'aliases'), false);

  const illness = findEntry(healthEntries, 'core_noun_krankheit');
  assert.deepEqual(illness.translations.en.aliases, ['the sickness']);
  assert.equal(Object.hasOwn(illness.translations.it, 'aliases'), false);

  const day = findEntry(timeEntries, 'core_noun_tag');
  assert.equal(Object.hasOwn(day.translations.it, 'aliases'), false);

  const night = findEntry(timeEntries, 'core_noun_nacht');
  assert.equal(Object.hasOwn(night.translations.it, 'aliases'), false);

  const morning = findEntry(timeEntries, 'core_noun_morgen');
  assert.deepEqual(morning.translations.it.aliases, ['la mattina']);

  const evening = findEntry(timeEntries, 'core_noun_abend');
  assert.equal(Object.hasOwn(evening.translations.it, 'aliases'), false);

  const year = findEntry(timeEntries, 'core_noun_jahr');
  assert.equal(Object.hasOwn(year.translations.it, 'aliases'), false);

  const beachten = findEntry(batch02, 'beachten');
  assert.equal(Object.hasOwn(beachten.translations.de, 'aliases'), false);
  assert.equal(Object.hasOwn(beachten.translations.en, 'aliases'), false);
  assert.equal(Object.hasOwn(beachten.translations.it, 'aliases'), false);

  const angebot = findEntry(batch02, 'angebot');
  assert.equal(Object.hasOwn(angebot.translations.de, 'aliases'), false);
  assert.equal(Object.hasOwn(angebot.translations.en, 'aliases'), false);
  assert.equal(Object.hasOwn(angebot.translations.it, 'aliases'), false);

  const abholen = findEntry(batch02, 'abholen');
  assert.equal(Object.hasOwn(abholen.translations.de, 'aliases'), false);
  assert.deepEqual(abholen.translations.en.aliases, ['pick someone up']);
  assert.deepEqual(abholen.translations.it.aliases, ['passare a prendere']);

  const wissen = findEntry(batch12, 'core_verb_wissen');
  assert.equal(Object.hasOwn(wissen.translations.it, 'aliases'), false);

  const bauchLegacy = findEntry(batch13, 'core_noun_bauch');
  assert.equal(bauchLegacy.translations.en.text, 'the belly');
  assert.equal(Object.hasOwn(bauchLegacy.translations.en, 'aliases'), false);
  assert.equal(Object.hasOwn(bauchLegacy.translations.it, 'aliases'), false);

  const kennen = findEntry(batch17, 'core_verb_kennen');
  assert.equal(kennen.translations.en.text, 'to know (a person/place)');
  assert.deepEqual(kennen.translations.en.aliases, ['to know']);
  assert.deepEqual(kennen.translations.it.aliases, ['conoscere']);

  const fahren = findEntry(batch18, 'core_verb_fahren');
  assert.equal(Object.hasOwn(fahren.translations.en, 'aliases'), false);
  assert.equal(Object.hasOwn(fahren.translations.it, 'aliases'), false);
  assert.equal(fahren.translations.en.definition, 'To operate and steer a vehicle.');

  const schoen = findEntry(batch18, 'core_adj_schoen');
  assert.equal(Object.hasOwn(schoen.translations.en, 'aliases'), false);
  assert.equal(Object.hasOwn(schoen.translations.it, 'aliases'), false);

  const brauchen = findEntry(healthEntries, 'core_verb_brauchen');
  assert.equal(Object.hasOwn(brauchen.translations.de, 'aliases'), false);
  assert.equal(Object.hasOwn(brauchen.translations.en, 'aliases'), false);
  assert.equal(Object.hasOwn(brauchen.translations.it, 'aliases'), false);

  const bauch = findEntry(healthEntries, 'core_noun_bauch');
  assert.equal(bauch.translations.en.text, 'the belly');
  assert.equal(Object.hasOwn(bauch.translations.en, 'aliases'), false);
  assert.equal(Object.hasOwn(bauch.translations.it, 'aliases'), false);

  const sitzen = findEntry(healthEntries, 'core_verb_sitzen');
  assert.equal(sitzen.translations.it.text, 'stare seduto');
  assert.deepEqual(sitzen.translations.it.aliases, ['essere seduto']);

  const ueberhauptNegative = findEntry(ueberhauptWave, 'ueberhaupt_negation');
  assert.equal(ueberhauptNegative.translations.de.text, 'überhaupt');
  assert.equal(ueberhauptNegative.translations.it.text, 'per niente');
  assert.deepEqual(ueberhauptNegative.translations.it.aliases, ['affatto']);
  assert.equal(Object.hasOwn(ueberhauptNegative.translations.en, 'aliases'), false);

  const ueberhauptGeneral = findEntry(ueberhauptWave, 'ueberhaupt_general');
  assert.equal(ueberhauptGeneral.translations.de.text, 'überhaupt');
  assert.equal(ueberhauptGeneral.translations.it.text, 'in generale');
  assert.equal(ueberhauptGeneral.translations.en.text, 'in general');

  const ueberhauptQuestion = findEntry(
    ueberhauptWave,
    'ueberhaupt_emphatic_question',
  );
  assert.equal(ueberhauptQuestion.translations.de.text, 'überhaupt');
  assert.equal(
    ueberhauptQuestion.translations.it.text,
    'poi (in domande enfatiche)',
  );
  assert.equal(
    ueberhauptQuestion.translations.en.text,
    'even (in emphatic questions)',
  );

  assert.equal(
    supportWave01.some(
      (entry) => entry.source_key === 'a1_answer_support_en_arzt_doctor',
    ),
    false,
  );
  assert.equal(
    supportWave01.some(
      (entry) => entry.source_key === 'a1_answer_support_it_arzt_dottore_bare',
    ),
    false,
  );
  assert.equal(
    supportWave11.some(
      (entry) => entry.source_key === 'a1_answer_support_en_aerztin_doctor',
    ),
    false,
  );
  assert.equal(
    supportWave11.some(
      (entry) => entry.source_key === 'a1_answer_support_en_aerztin_the_doctor',
    ),
    false,
  );
  assert.equal(
    supportWave07.some(
      (entry) => entry.source_key === 'a1_answer_support_en_bauch_belly',
    ),
    false,
  );
});
