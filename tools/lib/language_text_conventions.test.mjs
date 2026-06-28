import test from 'node:test';
import assert from 'node:assert/strict';

import {
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

test('leading article token list stays reusable across QA helpers', () => {
  const tokens = new Set(getLeadingArticleTokens());
  assert.equal(tokens.has('der'), true);
  assert.equal(tokens.has('l'), true);
  assert.equal(tokens.has('the'), true);
});
