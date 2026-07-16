// Console flow: review the queued word links, one keypress per decision
// (UI-04a/b/d). The queue is what `interconnect.mjs --queue-out` leaves for a
// human: one-sided assertions, wide spans, conflicts. Decisions become
// `source: "manual"` edges through the same shared logic the headless CLI
// uses (tools/lib/relation_queue.mjs).

import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { spawnSync } from 'child_process';
import { C } from '../colors.mjs';
import { confirm, readKey } from './prompt.mjs';
import { flattenQueue, decideQueueEntries, writeManualEdges, QUEUE_BUCKETS } from '../relation_queue.mjs';
import { MAX_LEVEL_SPAN } from '../concept_relations.mjs';
import { LANGS } from '../languages.mjs';

const QUEUE_REL = 'authoring/relation_queue.json';

const KEY_TO_DECISION = { s: 'synonym', a: 'antonym', r: 'related', x: 'reject' };

function regenerateQueue(repo) {
  console.log(C.dim('Refreshing the link queue from the current content...'));
  const r = spawnSync(process.execPath,
    [resolve(repo, 'tools/scripts/interconnect.mjs'), '--queue-out', QUEUE_REL],
    { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`interconnect --queue-out failed (exit ${r.status})`);
}

// concept_id -> { level, labels: {de,en,it} } for the review card.
function buildLabelIndex(content) {
  const idx = new Map();
  for (const c of content.concepts ?? []) {
    idx.set(c.concept_id, { level: c.level_override || c.level_auto || '?', labels: {} });
  }
  for (const lx of content.lexemes ?? []) {
    if (lx.is_active === false) continue;
    const row = idx.get(lx.concept_id);
    if (!row) continue;
    const lang = String(lx.lang).toLowerCase();
    if (LANGS.includes(lang) && (!row.labels[lang] || lx.is_primary)) row.labels[lang] = lx.text;
  }
  return idx;
}

function sideLine(conceptId, idx) {
  const row = idx.get(conceptId);
  if (!row) return C.red(`${conceptId} (missing concept)`);
  const words = LANGS.map((l) => (row.labels[l] ? `${C.gray(l)} ${C.b(row.labels[l])}` : null)).filter(Boolean).join('  ');
  return `${words || C.dim(conceptId)}  ${C.cyan(`[${row.level}]`)}`;
}

function renderCard(entry, i, total, idx) {
  const bucketNote = {
    one_sided: 'one side asserts, the other does not',
    wide_span: 'levels too far apart for the automatic writer',
    conflicts: 'the two sides disagree on the relation type',
  }[entry.bucket] ?? entry.bucket;
  console.log('\n' + C.cyan('-'.repeat(54)));
  console.log(C.dim(`[${i + 1}/${total}] `) + C.b(entry.relation_type ?? 'link') + C.dim(`  ·  ${bucketNote}`));
  console.log('  ' + sideLine(entry.concept_a, idx));
  console.log('  ' + C.dim('<->'));
  console.log('  ' + sideLine(entry.concept_b, idx));
  const evidence = [];
  if (Array.isArray(entry.asserted_by) && entry.asserted_by.length) {
    const who = entry.asserted_by.map((id) => idx.get(id)?.labels?.de ?? id);
    evidence.push(`asserted by: ${who.join(', ')}`);
  }
  if (Array.isArray(entry.langs) && entry.langs.length) evidence.push(`seen in: ${entry.langs.join(', ')}`);
  if (typeof entry.span === 'number') evidence.push(`level span: ${entry.span}`);
  if (evidence.length) console.log('  ' + C.dim(evidence.join('  ·  ')));
}

/** The menu handler. Returns when the user quits or the queue is exhausted. */
export async function doReviewLinks({ repo = process.cwd() } = {}) {
  const contentPath = resolve(repo, 'packs/lexicon_source/content.json');
  const queuePath = resolve(repo, QUEUE_REL);

  const stale = !existsSync(queuePath) || statSync(queuePath).mtimeMs < statSync(contentPath).mtimeMs;
  if (stale) regenerateQueue(repo);

  const queue = JSON.parse(readFileSync(queuePath, 'utf8'));
  const pending = flattenQueue(queue).filter((e) => typeof e.decision !== 'string');
  if (!pending.length) { console.log(C.green('\nNo word links waiting for review. ✅')); return; }

  const content = JSON.parse(readFileSync(contentPath, 'utf8'));
  const idx = buildLabelIndex(content);

  console.log(`\n${C.b(String(pending.length))} queued link(s).  ` +
    C.cyan('[s]') + 'ynonym  ' + C.cyan('[a]') + 'ntonym  ' + C.cyan('[r]') + 'elated  ' +
    C.cyan('[x]') + ' reject  ' + C.cyan('[Enter]') + ' skip  ' + C.cyan('[q]') + ' quit & apply');

  const decided = [];
  for (let i = 0; i < pending.length; i++) {
    const entry = pending[i];
    renderCard(entry, i, pending.length, idx);
    const wideSpan = typeof entry.span === 'number' && entry.span > MAX_LEVEL_SPAN;
    let allowed = ['s', 'a', 'r', 'x', 'enter', 'q'];
    if (wideSpan) {
      console.log('  ' + C.yellow(`⚠ span ${entry.span} exceeds the adjacency rule (max ${MAX_LEVEL_SPAN}) - `) +
        C.yellow('a link cannot be written; fix the concept level first.') +
        C.dim('  [x] reject / [Enter] skip / [q] quit'));
      allowed = ['x', 'enter', 'q'];
    }
    const key = await readKey(allowed);
    if (key === 'q') break;
    if (key === 'enter') continue;
    const decision = KEY_TO_DECISION[key];
    decided.push({ ...entry, decision });
    const shown = decision === 'reject' ? C.red('rejected') : C.green(decision);
    console.log('  ' + C.dim('-> ') + shown);
  }

  if (!decided.length) { console.log(C.dim('\nNothing decided - queue unchanged.')); return; }

  const { toWrite, rejected, refused } = decideQueueEntries(decided, content);
  console.log(`\nDecided ${decided.length}: ` + C.green(`${toWrite.length} link(s) to write`) +
    ` · ${rejected.length} rejected · ${refused.length} refused`);
  for (const [entry, why] of refused) {
    console.log('  ' + C.yellow(`REFUSED ${entry.concept_a} <-> ${entry.concept_b}: ${why}`));
  }
  if (!toWrite.length && !rejected.length) return;

  if (!(await confirm(C.b('\nApply now?') + ` ${C.dim('[y/N]')} `))) {
    console.log(C.dim('Discarded - queue unchanged.'));
    return;
  }

  writeManualEdges(contentPath, toWrite, { tool: 'console_review_links' });

  // Shrink the queue file: applied and rejected pairs leave, refused and
  // skipped stay pending (the refusal reason was just shown).
  const done = new Set([...toWrite.map((e) => `${e.concept_a}|${e.concept_b}`)]);
  for (const entry of rejected) {
    const [a, b] = [entry.concept_a, entry.concept_b].sort();
    done.add(`${a}|${b}`);
  }
  for (const bucket of QUEUE_BUCKETS) {
    queue[bucket] = (queue[bucket] ?? []).filter((e) => {
      const [a, b] = [e.concept_a, e.concept_b].sort();
      return !done.has(`${a}|${b}`);
    });
  }
  writeFileSync(queuePath, JSON.stringify(queue, null, 2) + '\n');

  const left = flattenQueue(queue).length;
  console.log(C.green(`Wrote ${toWrite.length} manual link(s).`) +
    C.dim(` ${left} still queued. To ship: `) + C.yellow('pnpm run lexicon') + C.dim(' -> Publish.'));
}
