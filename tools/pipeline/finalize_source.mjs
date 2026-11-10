// Finalize the source pack after any tool wrote concepts or lexemes: repair
// integrity, mint missing forms, run the review gate, then check that what was
// just written will really ship. Every writer (pipeline --entries, populate,
// the autopilot) runs this, so a new word never lands formless or held back.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { handleCliHelp } from '../lib/cli_help.mjs';
import { DEFAULT_SOURCE_PACK_DIR } from '../lib/default_pack_paths.mjs';
import { diagnoseContent, repairContent } from '../lib/content_integrity.mjs';

const HELP_TEXT = `
Usage:
  pnpm node tools/pipeline/finalize_source.mjs [options]

Repairs content integrity, mints missing lexeme forms (generate_pack_forms),
runs the review gate (review_autopromote --apply) and reports what will not
ship. With --require, exits 1 when any listed concept is still needs_review
or has an active word without forms.

Options:
  --pack-dir <dir>   Source pack directory. Default: packs/lexicon_source
  --require <file>   Entries JSON (a template wave) or a file with one concept id
                     per line: these concepts must ship
  -h, --help         Show this help message
`;

/** Concepts that will not ship: still needs_review, or a word without forms. */
export function unshippedConcepts(content, conceptIds) {
  const formLexemes = new Set(content.lexeme_forms.map((row) => row.lexeme_id));
  const problems = [];
  for (const conceptId of conceptIds) {
    const concept = content.concepts.find((row) => row.concept_id === conceptId);
    if (!concept) {
      problems.push({ conceptId, reason: 'missing from the source' });
      continue;
    }
    if (concept.review_status === 'needs_review') {
      problems.push({ conceptId, reason: 'held by the review gate (needs_review)' });
    }
    const formless = content.lexemes.filter(
      (row) => row.concept_id === conceptId && row.is_active !== false && !formLexemes.has(row.lexeme_id),
    );
    if (formless.length) {
      problems.push({ conceptId, reason: `no forms: ${formless.map((row) => row.lexeme_id).join(', ')}` });
    }
  }
  return problems;
}

export function readRequiredConceptIds(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.json')) {
    return [...new Set(JSON.parse(text).map((entry) => entry.concept_id).filter(Boolean))];
  }
  return [...new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
}

function runNode(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${path.basename(script)} failed (exit ${result.status}).`);
}

function main() {
  const argv = process.argv.slice(2);
  handleCliHelp(argv, HELP_TEXT);
  const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
  const packDir = path.resolve(option('--pack-dir') ?? DEFAULT_SOURCE_PACK_DIR);
  const requirePath = option('--require');
  const contentPath = path.join(packDir, 'content.json');
  const pipelineDir = import.meta.dirname;
  const read = () => JSON.parse(fs.readFileSync(contentPath, 'utf8'));

  const content = read();
  if (diagnoseContent(content).length) {
    const { fixes } = repairContent(content);
    if (fixes.length) {
      fs.writeFileSync(contentPath, `${JSON.stringify(content, null, 2)}\n`, 'utf8');
      for (const fix of fixes) console.log(`  repaired: ${fix}`);
    }
  }
  // Idempotent: only lexemes without forms get new ones.
  runNode(path.join(pipelineDir, 'generate_pack_forms.mjs'), ['--pack-dir', packDir]);
  runNode(path.join(pipelineDir, '../scripts/review_autopromote.mjs'), ['--file', contentPath, '--apply']);

  const after = read();
  const remaining = diagnoseContent(after);
  for (const issue of remaining) console.log(`  still open: ${issue.label} x${issue.count}`);
  const held = after.concepts.filter((row) => row.review_status === 'needs_review');
  if (held.length) console.log(`  ${held.length} concept(s) wait for a human in the review queue.`);

  if (requirePath) {
    const problems = unshippedConcepts(after, readRequiredConceptIds(path.resolve(requirePath)));
    if (problems.length) {
      console.error(`\n${problems.length} required concept problem(s), they will not ship:`);
      for (const problem of problems) console.error(`  ${problem.conceptId}: ${problem.reason}`);
      process.exit(1);
    }
    console.log('  every required concept will ship.');
  }
  if (remaining.length) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
