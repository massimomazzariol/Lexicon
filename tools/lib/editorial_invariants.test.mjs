import assert from 'node:assert/strict';
import test from 'node:test';

import { collectEditorialInvariantViolations } from './editorial_invariants.mjs';

function leaks(content) {
  return collectEditorialInvariantViolations({ content })
    .filter((violation) => violation.kind === 'internal_id_in_learner_text')
    .map((violation) => `${violation.field}: ${violation.value}`);
}

test('learner-facing text must not carry internal ids', () => {
  const content = {
    concepts: [{ concept_id: 'c-1', pos: 'adv' }],
    lexemes: [],
    concept_definitions: [
      {
        concept_id: 'c-1',
        lang: 'de',
        short_definition: 'Nur, schlicht.',
        usage_note: "Nicht 'leicht' (siehe Konzept ec6fe4e3).",
      },
      { concept_id: 'c-1', lang: 'en', usage_note: 'Not the adverb (see concept-a1-einfach-just).' },
      { concept_id: 'c-1', lang: 'it', usage_note: 'Solo il senso di luogo, non la congiunzione.' },
    ],
    examples: [{ example_id: 'e-1', concept_id: 'c-1', lang: 'de', sentence: 'Ich habe es vergessen.' }],
  };

  assert.deepEqual(leaks(content), [
    "concept_definitions.usage_note: Nicht 'leicht' (siehe Konzept ec6fe4e3).",
    'concept_definitions.usage_note: Not the adverb (see concept-a1-einfach-just).',
  ]);
});

test('the same word twice in one concept and language is a violation', () => {
  const lexeme = (id, lang, text) => ({ lexeme_id: id, concept_id: 'c-1', lang, text, pos: 'adv' });
  const content = {
    concepts: [{ concept_id: 'c-1', pos: 'adv' }],
    lexemes: [
      lexeme('lex-de-oft', 'de', 'oft'),
      lexeme('lex-de-oft-2', 'de', 'Oft'),
      lexeme('lex-de-haeufig', 'de', 'häufig'),
      lexeme('lex-en-often', 'en', 'oft'),
    ],
    concept_definitions: [],
  };
  const duplicates = collectEditorialInvariantViolations({ content })
    .filter((violation) => violation.kind === 'duplicate_lexeme_text')
    .map((violation) => violation.lexeme_id);
  assert.deepEqual(duplicates, ['lex-de-oft-2']);
});
