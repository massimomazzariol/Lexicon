import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  collectSenseIndicatorViolations,
  senseIndicatorFormatProblems,
} from './sense_indicators.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

function lexeme(conceptId, lang, text) {
  return { concept_id: conceptId, lang, text, is_active: true };
}

function definition(conceptId, lang, senseIndicator) {
  return { concept_id: conceptId, lang, sense_indicator: senseIndicator };
}

test('format: short plain labels pass, brackets, ids and long text fail', () => {
  assert.deepEqual(senseIndicatorFormatProblems('Fahrkarte, nur hin'), []);
  assert.ok(senseIndicatorFormatProblems('nur (Fahrkarte)').length > 0);
  assert.ok(senseIndicatorFormatProblems('siehe concept-a2-x').length > 0);
  assert.ok(senseIndicatorFormatProblems('one two three four five six').length > 0);
  assert.ok(senseIndicatorFormatProblems(' padded').length > 0);
});

test('a concept sharing a word needs a label in every language', () => {
  const violations = collectSenseIndicatorViolations({
    lexemes: [lexeme('c1', 'de', 'einfach'), lexeme('c2', 'de', 'einfach')],
    concept_definitions: [
      definition('c1', 'de', 'nicht schwer'),
      definition('c2', 'de', null),
    ],
  });
  assert.deepEqual(
    violations.map((v) => [v.concept_id, v.kind]),
    [['c2', 'missing']],
  );
});

test('a label must not repeat its own word and must differ from siblings', () => {
  const violations = collectSenseIndicatorViolations({
    lexemes: [
      lexeme('c1', 'it', 'la distanza'),
      lexeme('c2', 'it', 'la distanza'),
    ],
    concept_definitions: [
      definition('c1', 'it', 'distanza tra luoghi'),
      definition('c2', 'it', 'tra due luoghi'),
      definition('c1', 'de', 'zwischen Orten'),
      definition('c2', 'de', 'zwischen Orten'),
    ],
  });
  const kinds = violations.map((v) => `${v.concept_id}:${v.lang}:${v.kind}`);
  assert.ok(kinds.includes('c1:it:repeats_word'));
  assert.ok(kinds.includes('c2:de:not_distinct'));
});

// DL-014 over the real source: every concept that shares a word has a clean,
// distinct sense indicator in every language.
test('lexicon source: sense indicators are complete and clean (DL-014)', () => {
  const content = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'packs/lexicon_source/content.json'), 'utf8'),
  );
  const violations = collectSenseIndicatorViolations(content);
  assert.deepEqual(violations, []);
});
