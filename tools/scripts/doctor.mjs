// Content doctor - checks the source pack for integrity problems that would
// break the app (duplicate primary keys, unscored concepts, words with no forms)
// and repairs them with --fix.
//
//   pnpm run doctor            # report only (exit 1 if problems)
//   pnpm run doctor -- --fix   # repair in place, then mint any missing forms
//
// The console runs this automatically on entry and the autopilot heals at the
// start of every run, so a clean repo never needs this by hand - it is here for
// an explicit check or a CI gate.

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { spawnSync } from 'child_process';

import {
  diagnoseContent,
  repairContent,
  diagnoseCollisions,
} from '../lib/content_integrity.mjs';
import { C } from '../lib/colors.mjs';

const REPO = process.cwd();
const CONTENT = resolve(REPO, 'packs/lexicon_source/content.json');
const fix = process.argv.includes('--fix');

const content = JSON.parse(readFileSync(CONTENT, 'utf8'));
const issues = diagnoseContent(content);
const collisions = diagnoseCollisions(content);

// Advisory report: same prompt → 2+ target words. Not auto-fixable (needs the
// box to differentiate the translation), so it never drives the exit code.
function reportCollisions() {
  if (!collisions.length) return;
  console.log(
    C.yellow(
      `\n${collisions.length} translation collision(s) - review (not auto-fixable):`,
    ),
  );
  for (const c of collisions.slice(0, 20)) {
    console.log(
      '  ' + C.yellow('•') + ` ${c.lang.toUpperCase()} "${c.text}"` +
        C.dim(`  ← ${c.conceptIds.length} concepts: ${c.conceptIds.join(', ')}`),
    );
  }
  if (collisions.length > 20) {
    console.log(C.dim(`  ...and ${collisions.length - 20} more`));
  }
  console.log(
    C.dim(
      '  Same base-language prompt maps to 2+ target words; differentiate the translation (box).',
    ),
  );
}

if (!issues.length) {
  console.log(C.green('✓ content healthy - no integrity issues.'));
  reportCollisions();
  process.exit(0);
}

console.log(C.yellow(`Found ${issues.length} issue type(s):`));
for (const issue of issues) {
  console.log(
    '  ' + C.yellow('•') + ' ' + issue.label +
      C.dim(`  ×${issue.count}  e.g. ${issue.samples.join(', ')}`),
  );
}
reportCollisions();

if (!fix) {
  console.log(C.dim('\nRun ') + C.yellow('pnpm run doctor -- --fix') + C.dim(' to repair.'));
  process.exit(1);
}

console.log('');
const { fixes, needsFormGen } = repairContent(content);
if (fixes.length) {
  writeFileSync(CONTENT, JSON.stringify(content, null, 2) + '\n', 'utf8');
  for (const f of fixes) console.log('  ' + C.green('✓ ') + f);
}
if (needsFormGen) {
  console.log(C.dim('  minting missing forms (generate_pack_forms)...'));
  const result = spawnSync(
    process.execPath,
    [resolve(REPO, 'tools/pipeline/generate_pack_forms.mjs')],
    { stdio: 'inherit', cwd: REPO },
  );
  if (result.status === 0) console.log('  ' + C.green('✓ ') + 'forms generated');
  else { console.log(C.red('  form generation failed')); process.exit(result.status || 1); }
}

// Re-check so the exit code reflects the true post-repair state.
const remaining = diagnoseContent(JSON.parse(readFileSync(CONTENT, 'utf8')));
if (remaining.length) {
  console.log(C.yellow(`\n${remaining.length} issue type(s) still need a human.`));
  process.exit(1);
}
console.log(C.green('\n✓ all clear. Publish to ship the fixes.'));
