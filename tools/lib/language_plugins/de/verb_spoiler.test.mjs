import { test } from 'node:test';
import assert from 'node:assert/strict';
import { separableSpoilerForms, exampleDisclosesSeparable } from './verb_spoiler.mjs';

const aufstehen = separableSpoilerForms('aufstehen', {
  verb_class: 'separable', prefix: 'auf', stem: 'stehen', aux: 'sein',
  forms: { praes_2sg: 'stehst', praes_3sg: 'steht', praet_3sg: 'stand', partizip_ii: 'gestanden' },
});
const zurueckgeben = separableSpoilerForms('zurückgeben', {
  verb_class: 'separable', prefix: 'zurück', stem: 'geben', aux: 'haben',
  forms: { praes_2sg: 'gibst', praes_3sg: 'gibt', praet_3sg: 'gab', partizip_ii: 'gegeben' },
});

test('separable verb is detected when split and distant (präteritum)', () => {
  assert.equal(exampleDisclosesSeparable('Ich stand heute sehr früh auf.', aufstehen), true);
});

test('separable verb is detected via the present stem (discontiguous)', () => {
  assert.equal(exampleDisclosesSeparable('Ich stehe jeden Tag früh auf.', aufstehen), true);
});

test('strong imperative/2sg is detected (gib ... zurück)', () => {
  assert.equal(exampleDisclosesSeparable('Gib mir bitte das Buch zurück!', zurueckgeben), true);
});

test('contiguous infinitive / partizip is detected', () => {
  assert.equal(exampleDisclosesSeparable('Früh aufstehen ist schwer.', aufstehen), true);
  assert.equal(exampleDisclosesSeparable('Sie ist heute früh aufgestanden.', aufstehen), true);
});

test('the prefix alone (no stem form) is NOT a false positive', () => {
  assert.equal(exampleDisclosesSeparable('Das Buch liegt auf dem Tisch.', aufstehen), false);
});

test('an unrelated sentence is clean', () => {
  assert.equal(exampleDisclosesSeparable('Ich gehe zur Schule.', aufstehen), false);
});

test('a non-separable verb yields no descriptor', () => {
  assert.equal(separableSpoilerForms('essen', undefined), null);
  assert.equal(exampleDisclosesSeparable('Ich esse einen Apfel.', null), false);
});
