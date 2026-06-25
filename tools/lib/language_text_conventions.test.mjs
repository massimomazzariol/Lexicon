import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getDefaultNeutralDefinition,
  getDefaultSafeExample,
  getDefaultSafeExampleCandidates,
  getLeadingArticleTokens,
  inferSurfaceDefiniteness,
  stripLeadingArticle,
} from './language_text_conventions.mjs';

test('inferSurfaceDefiniteness detects definite and indefinite articles by language', () => {
  assert.equal(inferSurfaceDefiniteness('der Tisch', 'de'), 'def');
  assert.equal(inferSurfaceDefiniteness("l'orologio", 'it'), 'def');
  assert.equal(inferSurfaceDefiniteness('the clock', 'en'), 'def');
  assert.equal(inferSurfaceDefiniteness('una casa', 'it'), 'indef');
  assert.equal(inferSurfaceDefiniteness('an hour', 'en'), 'indef');
  assert.equal(inferSurfaceDefiniteness('casa', 'it'), 'bare');
});

test('stripLeadingArticle removes supported articles without changing bare forms', () => {
  assert.equal(stripLeadingArticle('die Uhr', 'de'), 'Uhr');
  assert.equal(stripLeadingArticle("l'orologio", 'it'), 'orologio');
  assert.equal(stripLeadingArticle('the watch', 'en'), 'watch');
  assert.equal(stripLeadingArticle('distance', 'en'), 'distance');
});

test('fallback language text defaults stay centralized', () => {
  assert.equal(
    getDefaultNeutralDefinition('de'),
    'Alltagssprache in einem neutralen Kontext.',
  );
  assert.equal(
    getDefaultNeutralDefinition('it'),
    'Uso quotidiano in un contesto neutro.',
  );
  assert.equal(
    getDefaultSafeExample('en'),
    'A person reacts in an everyday situation.',
  );
  assert.equal(
    getDefaultSafeExample('it', 'noun'),
    'Piu persone parlano con calma della stessa cosa.',
  );
  assert.equal(
    getDefaultSafeExample('de', 'chunk'),
    'In dieser Situation sagt eine Person genau das.',
  );
  assert.equal(
    getDefaultSafeExample('es'),
    'A person reacts in an everyday situation.',
  );
  assert.deepEqual(getDefaultSafeExampleCandidates('en').sort(), [
    'A person acts quite deliberately in this situation.',
    'A person reacts in an everyday situation.',
    'In this situation, a person says exactly that.',
    'In this situation, everything seems clearly that way.',
    'In this situation, it happens exactly that way.',
    'Several people calmly talk about the same thing.',
  ]);
});

test('leading article token list stays reusable across QA helpers', () => {
  const tokens = new Set(getLeadingArticleTokens());
  assert.equal(tokens.has('der'), true);
  assert.equal(tokens.has('l'), true);
  assert.equal(tokens.has('the'), true);
});
