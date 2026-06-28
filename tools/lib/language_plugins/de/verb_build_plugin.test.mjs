import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeGermanVerb, germanVerbStemSet, conjugateGermanVerb } from './verb_build_plugin.mjs';

// Base verbs the lexicon "knows" - remainder validation checks against these.
const knownStems = new Set(['stehen', 'rufen', 'bringen', 'kommen', 'fahren', 'freuen', 'holen', 'fangen', 'bereiten']);
const a = (lemma, override = null) => analyzeGermanVerb(lemma, { knownStems, override });

test('separable: prefix + known base verb', () => {
  assert.deepEqual(a('aufstehen'), { verb_class: 'separable', prefix: 'auf', stem: 'stehen', aux: 'haben' });
  assert.deepEqual(a('anrufen'), { verb_class: 'separable', prefix: 'an', stem: 'rufen', aux: 'haben' });
  assert.deepEqual(a('mitbringen'), { verb_class: 'separable', prefix: 'mit', stem: 'bringen', aux: 'haben' });
});

test('false-positive guard: ge/an lookalikes are simple, not split', () => {
  assert.equal(a('gehen').verb_class, 'simple'); // not ge+hen
  assert.equal(a('geben').verb_class, 'simple'); // not ge+ben
  assert.equal(a('antworten').verb_class, 'simple'); // not an+tworten ("tworten" isn't a verb)
});

test('inseparable: ver/be + known base verb', () => {
  assert.deepEqual(a('verstehen'), { verb_class: 'inseparable', prefix: 'ver', stem: 'stehen', aux: 'haben' });
  assert.deepEqual(a('bekommen'), { verb_class: 'inseparable', prefix: 'be', stem: 'kommen', aux: 'haben' });
});

test('variable prefix is never auto-split - flagged for curation', () => {
  const r = a('umfahren'); // um+fahren: run over (sep) vs drive around (insep) - opposite meanings
  assert.equal(r.verb_class, 'variable');
  assert.equal(r.prefix, 'um');
  assert.equal(r.stem, 'fahren');
  assert.equal(r.needs_curation, true);
});

test('override wins over rules (and sets aux)', () => {
  assert.deepEqual(a('umfahren', { verb_class: 'separable', prefix: 'um', stem: 'fahren', aux: 'sein' }),
    { verb_class: 'separable', prefix: 'um', stem: 'fahren', aux: 'sein' });
  assert.equal(a('gehen', { verb_class: 'simple', aux: 'sein' }).aux, 'sein');
});

test('reflexive marker is stripped before analysis', () => {
  assert.equal(a('sich freuen').verb_class, 'simple');
  assert.equal(a('sich freuen').stem, 'freuen');
});

test('conservative when the base verb is unknown → simple, never a wrong split', () => {
  // "abholen" is really ab+holen, but if "holen" weren't known it would stay simple.
  assert.equal(analyzeGermanVerb('abholen', { knownStems: new Set() }).verb_class, 'simple');
  assert.equal(a('abholen').verb_class, 'separable'); // holen IS known here
});

test('non-verb / non-infinitive input returns null', () => {
  assert.equal(a('Haus'), null);
  assert.equal(a('verbindlich'), null);
  assert.equal(a(''), null);
});

// ── conjugation (P2) ──────────────────────────────────────────────────────────
const conj = (lemma, override = null) => conjugateGermanVerb(lemma, { knownStems, override }).forms;

test('weak conjugation: regular -en verb', () => {
  const f = conj('machen');
  assert.equal(f.praes_2sg, 'machst');
  assert.equal(f.praes_3sg, 'macht');
  assert.equal(f.praet_3sg, 'machte');
  assert.equal(f.partizip_ii, 'gemacht');
  assert.equal(f.perfekt_3sg, 'hat gemacht');
  assert.equal(f.zu_inf, 'zu machen');
});

test('weak conjugation: e-insertion after -t/-d and consonant+m/n', () => {
  const a = conjugateGermanVerb('arbeiten', { knownStems }).forms;
  assert.equal(a.praes_2sg, 'arbeitest');
  assert.equal(a.praes_3sg, 'arbeitet');
  assert.equal(a.praet_3sg, 'arbeitete');
  assert.equal(a.partizip_ii, 'gearbeitet');
  assert.equal(conjugateGermanVerb('atmen', { knownStems }).forms.praes_2sg, 'atmest');
});

test('weak conjugation: sibilant 2sg contracts (du heißt, du reist)', () => {
  assert.equal(conjugateGermanVerb('heißen', { knownStems }).forms.praes_2sg, 'heißt');
  assert.equal(conjugateGermanVerb('reisen', { knownStems }).forms.praes_2sg, 'reist');
});

test('weak conjugation: -ieren has no ge in Partizip II', () => {
  const f = conjugateGermanVerb('studieren', { knownStems }).forms;
  assert.equal(f.praes_3sg, 'studiert');
  assert.equal(f.partizip_ii, 'studiert');
});

test('weak conjugation: -eln/-ern drop only -n', () => {
  const f = conjugateGermanVerb('sammeln', { knownStems }).forms;
  assert.equal(f.praes_2sg, 'sammelst');
  assert.equal(f.praes_3sg, 'sammelt');
  assert.equal(f.partizip_ii, 'gesammelt');
});

test('strong verb: override supplies praet/PII (and stem-change present)', () => {
  const f = conj('geben', { aux: 'haben', forms: { praes_2sg: 'gibst', praes_3sg: 'gibt', praet_3sg: 'gab', partizip_ii: 'gegeben' } });
  assert.equal(f.praes_3sg, 'gibt');
  assert.equal(f.praet_3sg, 'gab');
  assert.equal(f.partizip_ii, 'gegeben');
  const g = conj('gehen', { aux: 'sein', forms: { praet_3sg: 'ging', partizip_ii: 'gegangen' } });
  assert.equal(g.praes_3sg, 'geht'); // weak rule fine for the present here
  assert.equal(g.perfekt_3sg, 'ist gegangen');
});

test('separable verb composes discontinuous forms (base override cascades)', () => {
  // aufstehen ← strong base "stehen" (stand/gestanden), aux sein
  const f = conj('aufstehen', { aux: 'sein', forms: { praet_3sg: 'stand', partizip_ii: 'gestanden' } });
  assert.equal(f.praes_3sg, 'steht auf');
  assert.equal(f.praet_3sg, 'stand auf');
  assert.equal(f.partizip_ii, 'aufgestanden');
  assert.equal(f.zu_inf, 'aufzustehen');
  assert.equal(f.perfekt_3sg, 'ist aufgestanden');
});

test('germanVerbStemSet collects de verb infinitives only', () => {
  const set = germanVerbStemSet([
    { lang: 'de', pos: 'verb', lemma: 'stehen' },
    { lang: 'de', pos: 'verb', text: 'sich freuen' },
    { lang: 'de', pos: 'noun', lemma: 'Haus' },
    { lang: 'en', pos: 'verb', lemma: 'stand' }
  ]);
  assert.ok(set.has('stehen'));
  assert.ok(set.has('freuen')); // reflexive stripped
  assert.ok(!set.has('haus'));
  assert.ok(!set.has('stand'));
});
