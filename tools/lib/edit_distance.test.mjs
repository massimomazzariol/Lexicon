import assert from 'node:assert/strict';
import test from 'node:test';

import { boundedEditDistance, isTypoNeighbor } from './edit_distance.mjs';

test('boundedEditDistance scores basic edits', () => {
  assert.equal(boundedEditDistance('machen', 'machen'), 0);
  assert.equal(boundedEditDistance('haus', 'maus'), 1); // substitution
  assert.equal(boundedEditDistance('gehn', 'gehen'), 1); // insertion
  assert.equal(boundedEditDistance('gehen', 'gehn'), 1); // deletion
});

test('boundedEditDistance counts an adjacent transposition as one edit', () => {
  assert.equal(boundedEditDistance('machne', 'machen'), 1);
  assert.equal(boundedEditDistance('teh', 'the'), 1);
});

test('boundedEditDistance caps at maxDistance + 1 with early exit', () => {
  assert.equal(boundedEditDistance('abcdef', 'uvwxyz', 2), 3);
  assert.equal(boundedEditDistance('a', 'abcde', 2), 3); // length gap exceeds budget
});

test('isTypoNeighbor catches realistic typos but not short collisions', () => {
  assert.ok(isTypoNeighbor('machen', 'machne')); // transposition, len 6
  assert.ok(isTypoNeighbor('haus', 'haud')); // one sub, len 4
  assert.ok(isTypoNeighbor('grossartig', 'grosartig')); // one del, len 9 -> budget 2
  assert.ok(isTypoNeighbor('hand', 'sand')); // len 4, one sub -> within budget 1
  assert.ok(!isTypoNeighbor('hand', 'fund')); // len 4, two subs -> distance 2 > budget 1
  assert.ok(!isTypoNeighbor('rot', 'tor')); // len 3 -> too short, skipped
});

test('isTypoNeighbor is symmetric and ignores identical input', () => {
  assert.equal(isTypoNeighbor('machen', 'machen'), false);
  assert.equal(isTypoNeighbor('machne', 'machen'), isTypoNeighbor('machen', 'machne'));
});
