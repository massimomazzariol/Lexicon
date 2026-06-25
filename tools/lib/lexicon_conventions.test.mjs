import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_LEXICON_LEVEL,
  LEXICON_LEVELS,
  compareLexiconLevels,
  inferLexiconLevelFromPackId,
  lexiconLevelsBefore,
  lexiconLevelRank,
  normalizeLexiconLevel,
  normalizeLexiconLevels,
  replaceLexiconPackIdLevel,
  resolveLexiconLevelsSupported,
} from './lexicon_conventions.mjs';

test('normalizes supported CEFR levels consistently', () => {
  assert.equal(DEFAULT_LEXICON_LEVEL, 'A1');
  assert.deepEqual(LEXICON_LEVELS, ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
  assert.equal(normalizeLexiconLevel(' b1 '), 'B1');
  assert.equal(normalizeLexiconLevel('unknown'), null);
  assert.deepEqual(normalizeLexiconLevels(['a2', 'B1', 'A2', '']), ['A2', 'B1']);
});

test('compares and ranks CEFR levels in repository order', () => {
  assert.equal(lexiconLevelRank('A1'), 0);
  assert.equal(lexiconLevelRank('C2'), 5);
  assert.equal(lexiconLevelRank('unknown'), -1);
  assert.ok(compareLexiconLevels('A2', 'B1') < 0);
  assert.ok(compareLexiconLevels('C1', 'B2') > 0);
  assert.ok(compareLexiconLevels('unknown', 'B2') > 0);
  assert.deepEqual(lexiconLevelsBefore('B2'), ['A1', 'A2', 'B1']);
});

test('extracts and replaces levels inside pack ids', () => {
  assert.equal(inferLexiconLevelFromPackId('lexicon.de.a2.seed'), 'A2');
  assert.equal(inferLexiconLevelFromPackId('lexicon.source'), null);
  assert.equal(
    replaceLexiconPackIdLevel('lexicon.de.a2.seed', 'b1'),
    'lexicon.de.b1.seed',
  );
  assert.equal(replaceLexiconPackIdLevel('lexicon.source', 'A1'), null);
});

test('resolves supported levels from manifest fields without drift', () => {
  assert.deepEqual(
    resolveLexiconLevelsSupported({
      levelsSupported: ['a1', 'A2', ''],
      packLevel: 'B1',
      packId: 'lexicon.de.b1.seed',
    }),
    ['A1', 'A2'],
  );
  assert.deepEqual(
    resolveLexiconLevelsSupported({
      levelsSupported: [],
      packLevel: '',
      packId: 'lexicon.en.b2.seed',
    }),
    ['B2'],
  );
  assert.deepEqual(
    resolveLexiconLevelsSupported({
      levelsSupported: null,
      packLevel: null,
      packId: 'lexicon.source',
    }),
    [],
  );
});
