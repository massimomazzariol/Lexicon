// Content delta → detailed git commit message. Shared by the autopilot (autopilot.mjs)
// and the console (lexicon.mjs) so the generation box always pushes a commit that says,
// in plain words, exactly WHAT it created - new words, enrichment counts, and which model
// produced them. No more opaque "batch <timestamp>" commits. EPIC-ED-01.
//
// The delta is computed as HEAD:content.json vs the working-tree content.json, so it
// describes precisely what this commit introduces, regardless of how many chunks ran.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE_REL = 'packs/lexicon_source/content.json';

const cidOf = (x) => (x && typeof x === 'object' ? x.id : x);
const levelOf = (c) => c.level_override || c.level_auto || '?';
const arr = (d, k) => (Array.isArray(d?.[k]) ? d[k] : []);
const hasText = (v) => !!(v && String(v).trim());

/**
 * Structured delta between two content.json objects (old = previous commit, new = now).
 * Everything is "what's new/changed since old". Returns plain numbers + a new-words list +
 * a per-model provenance tally, ready for formatCommitMessage().
 */
export function diffContent(oldData, newData) {
  const old = oldData || {};
  const nw = newData || {};
  const idSet = (a, key) => new Set(a.map((x) => x[key]));

  // New concepts (= new headwords) and their level.
  const oldConceptIds = idSet(arr(old, 'concepts'), 'concept_id');
  const newConcepts = arr(nw, 'concepts').filter((c) => !oldConceptIds.has(c.concept_id));
  const perLevel = {};
  for (const c of newConcepts) { const lv = levelOf(c); perLevel[lv] = (perLevel[lv] || 0) + 1; }

  // New lexemes - used to name each new concept with its German surface form.
  const oldLexIds = idSet(arr(old, 'lexemes'), 'lexeme_id');
  const newLexemes = arr(nw, 'lexemes').filter((l) => !oldLexIds.has(l.lexeme_id));
  const lexByConcept = new Map();
  for (const l of newLexemes) {
    if (!lexByConcept.has(l.concept_id)) lexByConcept.set(l.concept_id, []);
    lexByConcept.get(l.concept_id).push(l);
  }
  const pickWord = (cid) => {
    const ls = lexByConcept.get(cid) || [];
    const de = ls.find((x) => x.lang === 'de' && x.is_primary) || ls.find((x) => x.lang === 'de') || ls[0];
    return de ? (de.text || de.lemma) : null;
  };
  const newWords = newConcepts
    .map((c) => ({ word: pickWord(c.concept_id), level: levelOf(c) }))
    .filter((w) => w.word);

  // NOTE: we deliberately do NOT surface which model produced anything. No AI/model name
  // ever goes into a commit message (or any committed file). Provenance in content.json is
  // a generic 'ai' marker only - see AI_PROVENANCE in authoring_core.mjs.

  // Definitions: count short_definition newly present (key = concept_id|lang).
  const defKey = (d) => `${cidOf(d.concept_id)}|${d.lang}`;
  const oldDefShort = new Map(arr(old, 'concept_definitions').map((d) => [defKey(d), hasText(d.short_definition)]));
  let defsFilled = 0;
  for (const d of arr(nw, 'concept_definitions')) {
    if (hasText(d.short_definition) && !oldDefShort.get(defKey(d))) defsFilled++;
  }

  // Synonyms / antonyms: net change in total entries across all definitions.
  const sumLen = (a, field) => a.reduce((s, d) => s + (Array.isArray(d[field]) ? d[field].length : 0), 0);
  const synDelta = sumLen(arr(nw, 'concept_definitions'), 'synonyms_json') - sumLen(arr(old, 'concept_definitions'), 'synonyms_json');
  const antDelta = sumLen(arr(nw, 'concept_definitions'), 'antonyms_json') - sumLen(arr(old, 'concept_definitions'), 'antonyms_json');

  // Examples: new by example_id, broken down by language.
  const oldExIds = idSet(arr(old, 'examples'), 'example_id');
  const newExamples = arr(nw, 'examples').filter((e) => !oldExIds.has(e.example_id));
  const exByLang = {};
  for (const e of newExamples) exByLang[e.lang] = (exByLang[e.lang] || 0) + 1;

  // Links: new clusters + member growth.
  const oldClusterIds = idSet(arr(old, 'clusters'), 'cluster_id');
  const newClusters = arr(nw, 'clusters').filter((c) => !oldClusterIds.has(c.cluster_id)).length;
  const memberDelta = arr(nw, 'cluster_members').length - arr(old, 'cluster_members').length;

  const totals = {
    concepts: arr(nw, 'concepts').length,
    lexemes: arr(nw, 'lexemes').length,
    definitions: arr(nw, 'concept_definitions').length,
    examples: arr(nw, 'examples').length,
    clusters: arr(nw, 'clusters').length
  };

  return {
    newWords, perLevel,
    newConcepts: newConcepts.length, newLexemes: newLexemes.length,
    defsFilled, synDelta, antDelta,
    newExamples: newExamples.length, exByLang,
    newClusters, memberDelta, totals
  };
}

/** Render the delta as { subject, body } for `git commit -m subject -m body`. */
export function formatCommitMessage(delta, { tag } = {}) {
  const { newWords, perLevel, newConcepts, defsFilled, synDelta, antDelta,
    newExamples, exByLang, newClusters, memberDelta, totals } = delta;

  // Subject: compact conventional summary of the dominant work.
  const bits = [];
  if (newConcepts) bits.push(`+${newConcepts} word${newConcepts === 1 ? '' : 's'}`);
  if (synDelta > 0) bits.push(`+${synDelta} syn`);
  if (newExamples) bits.push(`+${newExamples} ex`);
  if (!bits.length) {
    if (defsFilled) bits.push(`+${defsFilled} def`);
    if (antDelta > 0) bits.push(`+${antDelta} ant`);
    if (newClusters) bits.push(`+${newClusters} links`);
  }
  const levels = Object.keys(perLevel).sort();
  const lvSuffix = levels.length ? ` (${levels.join(',')})` : '';
  const subject = bits.length
    ? `content: ${bits.join(' · ')}${lvSuffix}`
    : 'chore(content): rebuild runtime packs';

  // Body: human-readable detail.
  const L = [];
  L.push(tag ? `Autopilot batch - ${tag}` : 'Autopilot content batch');
  L.push('');

  if (newWords.length) {
    const shown = newWords.slice(0, 40).map((w) => w.word).join(', ');
    const more = newWords.length > 40 ? ` ... (+${newWords.length - 40} more)` : '';
    L.push(`New words (${newWords.length}): ${shown}${more}`);
    if (levels.length) L.push(`By level: ${levels.map((l) => `${l} +${perLevel[l]}`).join(', ')}`);
    L.push('');
  }

  const enr = [];
  if (defsFilled) enr.push(`  definitions    +${defsFilled} filled`);
  if (synDelta > 0) enr.push(`  synonyms       +${synDelta}`);
  if (antDelta > 0) enr.push(`  antonyms       +${antDelta}`);
  if (newExamples) {
    const byl = Object.keys(exByLang).sort().map((l) => `${l} +${exByLang[l]}`).join(', ');
    enr.push(`  examples       +${newExamples}${byl ? ` (${byl})` : ''}`);
  }
  if (newClusters || memberDelta > 0) {
    enr.push(`  links/clusters +${newClusters} cluster${newClusters === 1 ? '' : 's'}${memberDelta > 0 ? `, +${memberDelta} members` : ''}`);
  }
  if (enr.length) { L.push('Enrichment:'); L.push(...enr); L.push(''); }

  L.push(`Totals now: ${totals.concepts} concepts · ${totals.lexemes} lexemes · ${totals.definitions} defs · ${totals.examples} examples · ${totals.clusters} clusters`);
  return { subject, body: L.join('\n') };
}

function readJSON(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
function gitHeadContent(repo) {
  // maxBuffer must exceed content.json (multi-MB) - the default 1MB truncates it and the
  // parse fails, which would make EVERY commit look like it created everything from scratch.
  const r = spawnSync('git', ['show', `HEAD:${SOURCE_REL}`], { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) return null; // first commit / file not yet tracked → treat as empty
  try { return JSON.parse(r.stdout); } catch { return null; }
}

/** Build the { subject, body } the next commit should carry (HEAD vs working tree). */
export function buildCommitMessage(repo, { tag } = {}) {
  const oldData = gitHeadContent(repo);
  const newData = readJSON(resolve(repo, SOURCE_REL));
  return formatCommitMessage(diffContent(oldData, newData || {}), { tag });
}

/**
 * The generation box is the sole pack author: stage packs, commit with a DETAILED message
 * describing exactly what was generated. Pushes ONLY when asked (push: true) - the public
 * history gets a curation pass before any push. Returns true on a successful commit.
 */
export function commitAndPush(repo, { tag, push = false } = {}) {
  const git = (a) => spawnSync('git', a, { stdio: 'inherit', cwd: repo });
  const { subject, body } = buildCommitMessage(repo, { tag }); // compute before staging (diff = HEAD vs tree)
  console.log(`\n  commit: ${subject}`);
  git(['add', 'packs']); // source + runtime packs
  if (spawnSync('git', ['commit', '-m', subject, '-m', body], { stdio: 'inherit', cwd: repo }).status !== 0) {
    console.log('  nothing to commit - skipping push.');
    return false;
  }
  if (!push) return true;
  if (git(['push']).status === 0) return true;
  // Push rejected - the other machine advanced origin while we generated. Self-heal: this is
  // called at a chunk boundary (nothing is being written right now), so it's safe to integrate
  // and retry. `-X ours` keeps OUR packs on any overlap (the box is the sole pack author), while
  // still pulling in the other machine's tooling/docs. The commit is already safe locally either way.
  console.log('  push rejected (origin moved) - pulling latest, then retrying...');
  if (git(['pull', '--no-rebase', '--no-edit', '-X', 'ours']).status !== 0) {
    git(['merge', '--abort']); // never leave a half-merged tree mid-run
    console.log('  auto-merge failed - your commit is saved locally. Run `git pull` then `git push` by hand.');
    return false;
  }
  if (git(['push']).status !== 0) {
    console.log('  push still failing - check remote/credentials. Your commit is saved locally.');
    return false;
  }
  return true;
}
