import test from 'node:test';
import assert from 'node:assert/strict';
import { flattenQueue, decideQueueEntries, QUEUE_BUCKETS } from './relation_queue.mjs';
import { relationId, DEFAULT_TIER } from './concept_relations.mjs';

const concept = (id, level) => ({ concept_id: id, level_auto: level });

function content() {
  return {
    concepts: [
      concept('c-haus', 'A1'),
      concept('c-wohnhaus', 'A2'),
      concept('c-gebaeude', 'C1'),
      concept('c-heim', 'A1'),
    ],
    concept_relations: [
      {
        relation_id: relationId('synonym', 'c-haus', 'c-heim'),
        relation_type: 'synonym',
        concept_a: 'c-haus',
        concept_b: 'c-heim',
        tier: 'close',
        lang_scope_json: null,
        source: 'resolved',
      },
    ],
  };
}

test('flattenQueue tags every entry with its bucket', () => {
  const queue = {
    one_sided: [{ concept_a: 'x', concept_b: 'y' }],
    wide_span: [{ concept_a: 'x', concept_b: 'z' }],
    conflicts: [],
  };
  const flat = flattenQueue(queue);
  assert.equal(flat.length, 2);
  assert.deepEqual(flat.map((e) => e.bucket), ['one_sided', 'wide_span']);
  assert.deepEqual(QUEUE_BUCKETS, ['one_sided', 'wide_span', 'conflicts']);
  assert.deepEqual(flattenQueue({}), []);
});

test('a synonym decision becomes a manual edge with the default tier and lang scope', () => {
  const entries = [{
    concept_a: 'c-wohnhaus', concept_b: 'c-haus',
    langs: ['de', 'en'], decision: 'synonym',
  }];
  const { toWrite, rejected, refused } = decideQueueEntries(entries, content());
  assert.equal(rejected.length, 0);
  assert.equal(refused.length, 0);
  assert.equal(toWrite.length, 1);
  const edge = toWrite[0];
  assert.equal(edge.relation_type, 'synonym');
  assert.equal(edge.source, 'manual');
  assert.equal(edge.tier, DEFAULT_TIER);
  assert.deepEqual(edge.lang_scope_json, ['de', 'en']);
  assert.ok(edge.concept_a < edge.concept_b, 'pair is normalized');
  assert.equal(edge.relation_id, relationId('synonym', edge.concept_a, edge.concept_b));
});

test('a non-synonym decision carries no tier; empty langs collapse to null scope', () => {
  const entries = [{ concept_a: 'c-haus', concept_b: 'c-wohnhaus', langs: [], decision: 'antonym' }];
  const { toWrite } = decideQueueEntries(entries, content());
  assert.equal(toWrite.length, 1);
  assert.equal(toWrite[0].relation_type, 'antonym');
  assert.ok(!('tier' in toWrite[0]));
  assert.equal(toWrite[0].lang_scope_json, null);
});

test('reject is recorded, never written', () => {
  const entries = [{ concept_a: 'c-haus', concept_b: 'c-wohnhaus', decision: 'reject' }];
  const { toWrite, rejected } = decideQueueEntries(entries, content());
  assert.equal(toWrite.length, 0);
  assert.equal(rejected.length, 1);
});

test('wide-span decisions are refused with the fix-the-level hint', () => {
  const entries = [{ concept_a: 'c-haus', concept_b: 'c-gebaeude', decision: 'synonym' }];
  const { toWrite, refused } = decideQueueEntries(entries, content());
  assert.equal(toWrite.length, 0);
  assert.equal(refused.length, 1);
  assert.match(refused[0][1], /fix the concept level first/);
});

test('a pair that already has an edge is refused (one relation per pair)', () => {
  const entries = [{ concept_a: 'c-heim', concept_b: 'c-haus', decision: 'related' }];
  const { toWrite, refused } = decideQueueEntries(entries, content());
  assert.equal(toWrite.length, 0);
  assert.match(refused[0][1], /already has an edge/);
});

test('unknown decisions are refused, undecided entries are skipped', () => {
  const entries = [
    { concept_a: 'c-haus', concept_b: 'c-wohnhaus', decision: 'maybe' },
    { concept_a: 'c-heim', concept_b: 'c-wohnhaus' },
  ];
  const { toWrite, rejected, refused } = decideQueueEntries(entries, content());
  assert.equal(toWrite.length, 0);
  assert.equal(rejected.length, 0);
  assert.equal(refused.length, 1);
  assert.match(refused[0][1], /unknown decision/);
});

test('two decisions on the same pair in one batch: second is refused', () => {
  const entries = [
    { concept_a: 'c-haus', concept_b: 'c-wohnhaus', decision: 'synonym' },
    { concept_a: 'c-wohnhaus', concept_b: 'c-haus', decision: 'related' },
  ];
  const { toWrite, refused } = decideQueueEntries(entries, content());
  assert.equal(toWrite.length, 1);
  assert.equal(refused.length, 1);
});
