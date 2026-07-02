import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { handleCliHelp } from '../lib/cli_help.mjs';
import { DEFAULT_SOURCE_PACK_DIR } from '../lib/default_pack_paths.mjs';

const HELP_TEXT = `
Usage:
  pnpm node tools/pipeline/rebuild_runtime_packs.mjs [options]

Rebuilds all runtime packs (packs/lexicon_*) from the canonical source pack.
For each pack, if the generated content.json differs from the previous build,
the patch version in manifest.json is auto-incremented so consumers detect the
update and re-import the pack on next startup.

After rebuilding, optionally builds the distribution. Publishing the built
distribution to a GitHub Release is a separate step
(tools/pipeline/publish_distribution_to_release.mjs).

Options:
  --source-pack-dir <dir>        Canonical source pack. Default: packs/lexicon_source
  --packs-root <dir>             Root containing runtime pack dirs. Default: packs
  --with-distribution            Also run build_lexicon_distribution.mjs after rebuild
  --dry-run                      Validate without writing any files
  -h, --help                     Show this help message
`;

function parseArgs(argv) {
  handleCliHelp(argv, HELP_TEXT);
  const options = {
    sourcePackDir: DEFAULT_SOURCE_PACK_DIR,
    packsRoot: 'packs',
    withDistribution: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source-pack-dir') options.sourcePackDir = argv[++i];
    else if (arg === '--packs-root') options.packsRoot = argv[++i];
    else if (arg === '--with-distribution') options.withDistribution = true;
    else if (arg === '--dry-run') options.dryRun = true;
  }

  return options;
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Bumps the patch segment of a semver-like version string.
 * "1.0.39" → "1.0.40". Falls back to appending ".1" if format is unexpected.
 */
function bumpPatchVersion(version) {
  const parts = String(version ?? '').split('.');
  if (parts.length === 3) {
    const patch = parseInt(parts[2], 10);
    parts[2] = String(isNaN(patch) ? 1 : patch + 1);
    return parts.join('.');
  }
  if (parts.length === 2) {
    const minor = parseInt(parts[1], 10);
    parts[1] = String(isNaN(minor) ? 1 : minor + 1);
    return parts.join('.');
  }
  return `${version}.1`;
}

function discoverRuntimePacks(packsRoot) {
  const entries = fs.readdirSync(packsRoot, { withFileTypes: true });
  const packs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(packsRoot, entry.name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      continue;
    }
    if (manifest.pack_role !== 'runtime') continue;
    packs.push({
      dirName: entry.name,
      packDir: path.join(packsRoot, entry.name),
      manifest,
    });
  }
  return packs;
}

function runNodeScript(scriptPath, args, { quiet = false } = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: quiet ? 'pipe' : 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    if (quiet && result.stderr?.length) {
      process.stderr.write(result.stderr);
    }
    throw new Error(`Script failed: ${path.basename(scriptPath)}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packsRoot = path.resolve(options.packsRoot);
  const sourcePackDir = path.resolve(options.sourcePackDir);
  const toolsDir = import.meta.dirname;

  const runtimePacks = discoverRuntimePacks(packsRoot);
  if (runtimePacks.length === 0) {
    console.error(`No runtime packs found in: ${packsRoot}`);
    process.exit(1);
  }

  console.log(
    `Rebuilding ${runtimePacks.length} runtime packs from ${path.relative(process.cwd(), sourcePackDir)}${options.dryRun ? ' (dry run)' : ''}...\n`,
  );

  let rebuilt = 0;
  let bumped = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const pack of runtimePacks) {
    const { dirName, packDir, manifest } = pack;
    const contentPath = path.join(packDir, 'content.json');
    const manifestPath = path.join(packDir, 'manifest.json');

    const targetLang = (manifest.languages_target_supported ?? [])[0];
    const level = manifest.pack_level ?? (manifest.levels_supported ?? [])[0];
    const kind =
      (manifest.kind ?? 'vocab').toString().trim().toLowerCase() === 'expressions'
        ? 'expressions'
        : 'vocab';

    if (!targetLang || !level || !manifest.pack_id || !manifest.version) {
      console.warn(`  [SKIP] ${dirName}: missing required manifest fields`);
      skipped++;
      continue;
    }

    const hashBefore = fs.existsSync(contentPath) ? hashFile(contentPath) : null;

    const buildArgs = [
      '--source-pack-dir', sourcePackDir,
      '--dest-pack-dir', packDir,
      '--pack-id', manifest.pack_id,
      '--target-lang', targetLang,
      '--level', level,
      '--kind', kind,
      '--version', manifest.version,
    ];
    if (options.dryRun) buildArgs.push('--dry-run');

    runNodeScript(
      path.join(toolsDir, 'build_target_pack_from_source.mjs'),
      buildArgs,
      { quiet: !options.dryRun },
    );

    if (options.dryRun) {
      console.log(`  ${dirName}: dry-run ok (${manifest.version})`);
      continue;
    }

    rebuilt++;
    const hashAfter = hashFile(contentPath);

    if (hashBefore !== hashAfter) {
      const newVersion = bumpPatchVersion(manifest.version);
      const updatedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      updatedManifest.version = newVersion;
      fs.writeFileSync(manifestPath, `${JSON.stringify(updatedManifest, null, 2)}\n`, 'utf8');
      console.log(`  ${dirName}: rebuilt  ${manifest.version} → ${newVersion}  (content changed)`);
      bumped++;
    } else {
      console.log(`  ${dirName}: no changes (${manifest.version})`);
      unchanged++;
    }
  }

  if (options.dryRun) {
    console.log('\nDry run complete - no files were written.');
    return;
  }

  console.log(
    `\nRebuilt ${rebuilt} packs: ${bumped} version-bumped, ${unchanged} unchanged, ${skipped} skipped.`,
  );

  if (options.withDistribution) {
    console.log('\nBuilding distribution...');
    runNodeScript(path.join(toolsDir, 'build_lexicon_distribution.mjs'), []);
  }
}

main();
