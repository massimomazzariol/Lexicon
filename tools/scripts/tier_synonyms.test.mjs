import { test } from 'node:test';
import assert from 'node:assert/strict';

import { coerceTier, toArr, needsTiering, tiersToStore, TIERS } from './tier_synonyms.mjs';

test('coerceTier accepts the enum and defaults everything else to close', () => {
  assert.equal(coerceTier('exact'), 'exact');
  assert.equal(coerceTier('EXACT'), 'exact');
  assert.equal(coerceTier(' Loose '), 'loose');
  assert.equal(coerceTier('close'), 'close');
  assert.equal(coerceTier('perfect'), 'close'); // unknown -> default
  assert.equal(coerceTier(undefined), 'close');
  assert.equal(coerceTier(''), 'close');
  assert.deepEqual([...TIERS].sort(), ['close', 'exact', 'loose']);
});

test('toArr handles arrays, JSON strings, and junk', () => {
  assert.deepEqual(toArr(['a', 'b']), ['a', 'b']);
  assert.deepEqual(toArr('["x","y"]'), ['x', 'y']);
  assert.deepEqual(toArr('not json'), []);
  assert.deepEqual(toArr(undefined), []);
  assert.deepEqual(toArr(42), []);
});

test('needsTiering: synonyms present AND never reviewed', () => {
  assert.equal(needsTiering({ synonyms_json: ['a'] }), true); // no tiers map -> needs it
  assert.equal(needsTiering({ synonyms_json: ['a'], synonym_tiers_json: {} }), false); // reviewed (all-close marker)
  assert.equal(needsTiering({ synonyms_json: ['a'], synonym_tiers_json: { a: 'exact' } }), false); // reviewed
  assert.equal(needsTiering({ synonyms_json: [] }), false); // nothing to tier
  assert.equal(needsTiering({}), false);
});

test('tiersToStore keeps only exact/loose, drops close, preserves existing tiers', () => {
  const rated = { rapido: 'exact', svelto: 'close', lesto: 'loose' };
  const stored = tiersToStore(['rapido', 'svelto', 'lesto'], rated);
  assert.deepEqual(stored, { rapido: 'exact', lesto: 'loose' }); // close omitted (it is the default)
});

test('tiersToStore never overwrites an existing (e.g. human) tier', () => {
  const rated = { a: 'exact', b: 'loose' };
  const stored = tiersToStore(['a', 'b'], rated, { a: 'loose' }); // a was set by a human to loose
  assert.equal(stored.a, 'loose'); // preserved
  assert.equal(stored.b, 'loose'); // new one filled
});

test('tiersToStore returns {} when every alternative is close (the reviewed marker)', () => {
  const stored = tiersToStore(['x', 'y'], { x: 'close', y: 'close' });
  assert.deepEqual(stored, {});
});
