import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { handleCliHelp } from '../lib/cli_help.mjs';
import { planReleaseAssets } from '../lib/distribution_release_assets.mjs';

/**
 * Publishes a built Lexicon distribution to a GitHub Release as flat,
 * per-file assets (ADR-0002). Each distribution file becomes one Release asset
 * whose name is the flattened relative path (see distribution_release_assets).
 *
 * GitHub Release asset names are the uploaded file's basename - there is no
 * rename flag - so we stage every file into a temp dir under its flattened
 * name and upload from there.
 *
 * Default mode is DRY RUN: it prints the publish plan and touches nothing.
 * Actually creating/updating a Release is outward-facing, so it only happens
 * with --publish and an explicit --tag.
 */
const HELP_TEXT = `
Usage:
  node tools/pipeline/publish_distribution_to_release.mjs [options]

Publishes dist/lexicon_distribution/ to a GitHub Release as flat per-file
assets. Dry run by default - prints the plan and changes nothing.

Options:
  --dist-dir <dir>   Built distribution dir. Default: dist/lexicon_distribution
  --tag <tag>        Release tag to publish to (required with --publish)
  --title <title>    Release title (only used when creating a new release)
  --notes <notes>    Release notes body (only used when creating). Default: ""
  --publish          Actually create/update the Release and upload assets.
                     Without this flag the script only prints the plan.
  -h, --help         Show this help message
`;

function parseArgs(argv) {
  handleCliHelp(argv, HELP_TEXT);
  const options = {
    distDir: 'dist/lexicon_distribution',
    tag: null,
    title: null,
    notes: '',
    publish: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dist-dir') options.distDir = argv[++i];
    else if (arg === '--tag') options.tag = argv[++i];
    else if (arg === '--title') options.title = argv[++i];
    else if (arg === '--notes') options.notes = argv[++i];
    else if (arg === '--publish') options.publish = true;
  }
  return options;
}

/**
 * Args for `gh release create`. Always passes --notes so gh never drops into
 * an interactive editor (this runs non-interactively).
 */
export function buildReleaseCreateArgs(tag, { title, notes } = {}) {
  const args = ['release', 'create', tag];
  if (title) args.push('--title', title);
  args.push('--notes', notes ?? '');
  return args;
}

/** Args for `gh release upload` (--clobber so re-publishing a tag overwrites). */
export function buildReleaseUploadArgs(tag, files, { clobber = true } = {}) {
  const args = ['release', 'upload', tag, ...files];
  if (clobber) args.push('--clobber');
  return args;
}

/**
 * Copies every planned file into stagingDir under its flattened asset name,
 * so `gh release upload` names the asset correctly. Returns the staged paths.
 */
export function stageFlattenedAssets(plan, stagingDir) {
  fs.mkdirSync(stagingDir, { recursive: true });
  const staged = [];
  for (const entry of plan) {
    const dest = path.join(stagingDir, entry.assetName);
    fs.copyFileSync(entry.absPath, dest);
    staged.push(dest);
  }
  return staged;
}

function runGh(args) {
  const result = spawnSync('gh', args, { stdio: 'inherit', shell: false });
  if (result.error) {
    throw new Error(`Failed to run gh: ${result.error.message}`);
  }
  return result.status ?? 1;
}

function releaseExists(tag) {
  const result = spawnSync('gh', ['release', 'view', tag], {
    stdio: 'ignore',
    shell: false,
  });
  return result.status === 0;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const distDir = path.resolve(options.distDir);
  const plan = planReleaseAssets(distDir);

  console.log(`Distribution: ${distDir}`);
  console.log(`Tag:          ${options.tag ?? '(required for --publish)'}`);
  console.log(`Assets:       ${plan.length}`);
  for (const entry of plan) {
    console.log(`  ${entry.relPath}  ->  ${entry.assetName}`);
  }

  if (!options.publish) {
    console.log(
      '\nDry run - nothing was published. ' +
        'Re-run with --publish --tag <tag> to create/update the Release.',
    );
    return;
  }

  if (!options.tag) {
    console.error('\n--tag <tag> is required with --publish.');
    process.exit(1);
  }

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-release-'));
  try {
    const staged = stageFlattenedAssets(plan, stagingDir);
    if (releaseExists(options.tag)) {
      console.log(`\nRelease ${options.tag} exists - uploading ${staged.length} assets...`);
      const status = runGh(buildReleaseUploadArgs(options.tag, staged));
      if (status !== 0) process.exit(status);
    } else {
      console.log(`\nCreating release ${options.tag} with ${staged.length} assets...`);
      const status = runGh([
        ...buildReleaseCreateArgs(options.tag, {
          title: options.title,
          notes: options.notes,
        }),
        ...staged,
      ]);
      if (status !== 0) process.exit(status);
    }
    console.log(`\nPublished ${staged.length} assets to release ${options.tag}.`);
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
