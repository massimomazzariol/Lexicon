import assert from 'node:assert/strict';
import test from 'node:test';

import {
  diagnoseContent,
  repairContent,
  diagnoseCollisions,
} from './content_integrity.mjs';

function fixture() {
  return {
    concepts: [
      // duplicate concept_id: the reviewed/richer one must win.
      {
        concept_id: 'c-eindeutig',
        pos: 'adj',
        level_auto: 'B2',
        difficulty_score_auto: 65,
        review_status: 'reviewed',
        notes: 'clear',
      },
      { concept_id: 'c-eindeutig', pos: 'adj', level_auto: 'B2', difficulty_score_auto: null },
      // unscored concept (null difficulty) -> backfilled from level.
      { concept_id: 'c-neu', pos: 'verb', level_auto: 'A1', difficulty_score_auto: null },
    ],
    lexemes: [
      { lexeme_id: 'lex-de-neu', concept_id: 'c-neu', lang: 'de', text: 'machen', is_primary: true },
      { lexeme_id: 'lex-de-eindeutig', concept_id: 'c-eindeutig', lang: 'de', text: 'eindeutig', is_primary: true },
    ],
    lexeme_forms: [
      // lex-de-eindeutig has a core form; lex-de-neu has NONE -> missing_forms.
      { form_id: 'f1', lexeme_id: 'lex-de-eindeutig', lang: 'de', surface: 'eindeutig', tags_json: { slot_key: 'core' } },
    ],
    concept_definitions: [
      { concept_id: 'c-eindeutig', lang: 'de', short_definition: 'klar und unmissverständlich', synonyms_json: ['klar'] },
      { concept_id: 'c-eindeutig', lang: 'de', short_definition: 'klar' }, // thinner duplicate
    ],
  };
}

test('diagnoseContent surfaces every integrity problem', () => {
  const issues = diagnoseContent(fixture());
  const kinds = issues.map((i) => i.kind).sort();
  assert.deepEqual(kinds, [
    'duplicate_concept',
    'duplicate_definition',
    'missing_difficulty',
    'missing_forms',
  ]);
  const forms = issues.find((i) => i.kind === 'missing_forms');
  assert.equal(forms.needsFormGen, true);
  assert.deepEqual(forms.samples, ['lex-de-neu']);
});

test('repairContent dedupes (richest wins), backfills difficulty, flags form gen', () => {
  const content = fixture();
  const { fixes, needsFormGen } = repairContent(content);

  // concept dedupe kept the reviewed/richer row.
  const concepts = content.concepts.filter((c) => c.concept_id === 'c-eindeutig');
  assert.equal(concepts.length, 1);
  assert.equal(concepts[0].review_status, 'reviewed');
  assert.equal(concepts[0].difficulty_score_auto, 65);

  // definition dedupe kept the richer one.
  const defs = content.concept_definitions.filter(
    (d) => d.concept_id === 'c-eindeutig' && d.lang === 'de',
  );
  assert.equal(defs.length, 1);
  assert.equal(defs[0].short_definition, 'klar und unmissverständlich');

  // null difficulty backfilled from level (A1 -> 20).
  assert.equal(content.concepts.find((c) => c.concept_id === 'c-neu').difficulty_score_auto, 20);

  // missing form still needs the generator.
  assert.equal(needsFormGen, true);
  assert.ok(fixes.length >= 3);

  // repair is idempotent: a second diagnose finds only the (generator-owned) forms gap.
  const issues = diagnoseContent(content);
  assert.deepEqual(issues.map((i) => i.kind), ['missing_forms']);
});

test('diagnose + repair detect and remove orphan rows', () => {
  const content = {
    concepts: [{ concept_id: 'c1', level_auto: 'A1', difficulty_score_auto: 20 }],
    lexemes: [
      { lexeme_id: 'l1', concept_id: 'c1', lang: 'de', is_primary: true },
      { lexeme_id: 'l-orphan', concept_id: 'c-gone', lang: 'de', is_primary: true }, // orphan
    ],
    lexeme_forms: [
      { form_id: 'f1', lexeme_id: 'l1', lang: 'de', surface: 'x', tags_json: { slot_key: 'core' } },
      { form_id: 'f-orphan', lexeme_id: 'l-missing', lang: 'de', surface: 'y' }, // orphan
    ],
    concept_definitions: [
      { concept_id: 'c1', lang: 'de', short_definition: 'd' },
      { concept_id: 'c-gone', lang: 'de', short_definition: 'orphan' }, // orphan
    ],
    examples: [{ example_id: 'e-orphan', concept_id: 'c-gone', lang: 'de', sentence: 's' }], // orphan
  };

  const kinds = diagnoseContent(content).map((i) => i.kind);
  assert.ok(kinds.includes('orphan_lexeme'));
  assert.ok(kinds.includes('orphan_form'));
  assert.ok(kinds.includes('orphan_definition'));
  assert.ok(kinds.includes('orphan_example'));

  repairContent(content);
  assert.deepEqual(content.lexemes.map((l) => l.lexeme_id), ['l1']);
  assert.deepEqual(content.lexeme_forms.map((f) => f.form_id), ['f1']);
  assert.deepEqual(content.concept_definitions.map((d) => d.concept_id), ['c1']);
  assert.equal(content.examples.length, 0);
  assert.deepEqual(diagnoseContent(content), []);
});

test('hygiene: strips leaked German from IT/EN antonyms, keeps cognate synonyms, drops echo examples', () => {
  const content = {
    concepts: [
      { concept_id: 'c-frau', level_auto: 'A1', difficulty_score_auto: 20 },
      { concept_id: 'c-screen', level_auto: 'A2', difficulty_score_auto: 35 },
    ],
    lexemes: [
      { lexeme_id: 'l-frau', concept_id: 'c-frau', lang: 'de', text: 'Frau', is_primary: true },
      { lexeme_id: 'l-frau-it', concept_id: 'c-frau', lang: 'it', text: 'la donna', is_primary: false },
      { lexeme_id: 'l-screen', concept_id: 'c-screen', lang: 'de', text: 'Bildschirm', is_primary: true },
      { lexeme_id: 'l-screen-it', concept_id: 'c-screen', lang: 'it', text: 'lo schermo', is_primary: false },
    ],
    lexeme_forms: [
      { form_id: 'ff1', lexeme_id: 'l-frau', lang: 'de', surface: 'Frau', tags_json: { slot_key: 'core' } },
      { form_id: 'ff2', lexeme_id: 'l-screen', lang: 'de', surface: 'Bildschirm', tags_json: { slot_key: 'core' } },
    ],
    concept_definitions: [
      { concept_id: 'c-frau', lang: 'de', short_definition: 'weibliche Person', antonyms_json: ['der Mann'] },
      { concept_id: 'c-frau', lang: 'it', short_definition: 'persona di sesso femminile', antonyms_json: ['il marito', 'der Mann'] },
      // cognate: "Monitor" is German here, but "monitor" is also a valid Italian word.
      { concept_id: 'c-screen', lang: 'de', short_definition: 'Anzeigegerät', synonyms_json: ['Monitor'] },
      { concept_id: 'c-screen', lang: 'it', short_definition: 'dispositivo di visualizzazione', synonyms_json: ['monitor'] },
    ],
    examples: [
      { example_id: 'e1', concept_id: 'c-frau', lang: 'it', sentence: 'La donna legge un libro.' },
      { example_id: 'e2', concept_id: 'c-screen', lang: 'it', sentence: 'dispositivo di visualizzazione' }, // echoes def
    ],
  };

  const kinds = diagnoseContent(content).map((i) => i.kind);
  assert.ok(kinds.includes('language_leak'));
  assert.ok(kinds.includes('example_echoes_definition'));

  repairContent(content);

  // leaked German antonym removed, the real Italian antonym kept.
  const itAnt = content.concept_definitions.find((d) => d.concept_id === 'c-frau' && d.lang === 'it').antonyms_json;
  assert.deepEqual(itAnt, ['il marito']);

  // cognate synonym is NEVER stripped - synonyms are graded answers.
  const itSyn = content.concept_definitions.find((d) => d.concept_id === 'c-screen' && d.lang === 'it').synonyms_json;
  assert.deepEqual(itSyn, ['monitor']);

  // the example that echoed the definition is gone; the real one stays.
  assert.deepEqual(content.examples.map((e) => e.example_id), ['e1']);

  // idempotent: the hygiene problems do not reappear.
  const after = diagnoseContent(content).map((i) => i.kind);
  assert.ok(!after.includes('language_leak'));
  assert.ok(!after.includes('example_echoes_definition'));
});

test('diagnoseCollisions flags shared base-language primaries, ignores German homographs', () => {
  const content = {
    concepts: [
      { concept_id: 'c-holen', level_auto: 'A1', difficulty_score_auto: 20 },
      { concept_id: 'c-abholen', level_auto: 'A2', difficulty_score_auto: 35 },
      { concept_id: 'c-bank-seat', level_auto: 'A2', difficulty_score_auto: 35 },
      { concept_id: 'c-bank-money', level_auto: 'A2', difficulty_score_auto: 35 },
      { concept_id: 'c-haus', level_auto: 'A1', difficulty_score_auto: 20 },
    ],
    lexemes: [
      // IT collision: two different concepts → identical IT primary.
      { lexeme_id: 'l-holen-de', concept_id: 'c-holen', lang: 'de', text: 'holen', is_primary: true },
      { lexeme_id: 'l-holen-it', concept_id: 'c-holen', lang: 'it', text: 'andare a prendere', is_primary: true },
      { lexeme_id: 'l-abholen-de', concept_id: 'c-abholen', lang: 'de', text: 'abholen', is_primary: true },
      // case/spacing differences must still collide (normalized).
      { lexeme_id: 'l-abholen-it', concept_id: 'c-abholen', lang: 'it', text: 'Andare a  prendere', is_primary: true },
      // German homograph: same DE primary on two concepts → NOT flagged (de excluded).
      { lexeme_id: 'l-bank1', concept_id: 'c-bank-seat', lang: 'de', text: 'Bank', is_primary: true },
      { lexeme_id: 'l-bank2', concept_id: 'c-bank-money', lang: 'de', text: 'Bank', is_primary: true },
      // unique IT primary → no collision.
      { lexeme_id: 'l-haus-it', concept_id: 'c-haus', lang: 'it', text: 'casa', is_primary: true },
      // a non-primary IT synonym duplicating the text must NOT create a collision.
      { lexeme_id: 'l-haus-syn', concept_id: 'c-haus', lang: 'it', text: 'andare a prendere', is_primary: false },
    ],
  };

  const collisions = diagnoseCollisions(content);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].lang, 'it');
  assert.deepEqual(collisions[0].conceptIds.sort(), ['c-abholen', 'c-holen']);
});

test('diagnoseCollisions excludes German by default but can include it', () => {
  const content = {
    concepts: [
      { concept_id: 'c1', level_auto: 'A2', difficulty_score_auto: 35 },
      { concept_id: 'c2', level_auto: 'A2', difficulty_score_auto: 35 },
    ],
    lexemes: [
      { lexeme_id: 'l1', concept_id: 'c1', lang: 'de', text: 'Bank', is_primary: true },
      { lexeme_id: 'l2', concept_id: 'c2', lang: 'de', text: 'Bank', is_primary: true },
    ],
  };
  assert.equal(diagnoseCollisions(content).length, 0); // de excluded by default
  assert.equal(diagnoseCollisions(content, { excludeLangs: [] }).length, 1);
});

test('typography: em/en dashes and ellipsis are flagged and normalized everywhere', () => {
  const content = {
    concepts: [{ concept_id: 'c1', level_auto: 'A1', difficulty_score_auto: 20 }],
    lexemes: [{ lexeme_id: 'l1', concept_id: 'c1', lang: 'de', text: 'x', is_primary: true }],
    lexeme_forms: [{ form_id: 'f1', lexeme_id: 'l1', lang: 'de', surface: 'x', tags_json: { slot_key: 'core' } }],
    concept_definitions: [
      { concept_id: 'c1', lang: 'de', short_definition: 'a — b – c …', synonyms_json: ['x—y'] },
    ],
    examples: [{ example_id: 'e1', concept_id: 'c1', lang: 'de', sentence: 'Er kommt — bald …' }],
  };

  assert.ok(diagnoseContent(content).some((i) => i.kind === 'long_dash'));

  repairContent(content);
  const def = content.concept_definitions[0];
  assert.equal(def.short_definition, 'a - b - c ...');
  assert.deepEqual(def.synonyms_json, ['x-y']);
  assert.equal(content.examples[0].sentence, 'Er kommt - bald ...');

  // idempotent: no long-dash issue remains
  assert.ok(!diagnoseContent(content).some((i) => i.kind === 'long_dash'));
});

test('diagnoseContent returns empty for healthy content', () => {
  const content = {
    concepts: [{ concept_id: 'c1', level_auto: 'A1', difficulty_score_auto: 20 }],
    lexemes: [{ lexeme_id: 'l1', concept_id: 'c1', lang: 'de', is_primary: true }],
    lexeme_forms: [{ form_id: 'f1', lexeme_id: 'l1', lang: 'de', surface: 'x', tags_json: { slot_key: 'core' } }],
    concept_definitions: [{ concept_id: 'c1', lang: 'de', short_definition: 'd' }],
  };
  assert.deepEqual(diagnoseContent(content), []);
});
