import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { handleCliHelp } from '../lib/cli_help.mjs';
import { DEFAULT_SOURCE_PACK_DIR } from '../lib/default_pack_paths.mjs';

const DEFAULT_PACK_DIR = DEFAULT_SOURCE_PACK_DIR;
const DEFAULT_OUT_DIR = process.env.PACK_AUDIT_OUT_DIR ?? 'docs/data';
const HELP_TEXT = `
Usage:
  pnpm node tools/pipeline/run_pack_pipeline.mjs [options]

Runs the source-pack authoring pipeline: upsert → curate → sanitize → QA → nouns.
This script operates on the canonical source pack only.

To rebuild runtime packs after this pipeline, run:
  pnpm run rebuild    # rebuilds all 36 runtime packs, auto-bumps version on change
  pnpm run release    # rebuild + build the distribution

Options:
  --pack-dir <dir>         Canonical source pack directory. Default: packs/lexicon_source
  --entries <file>         Editorial entries JSON to upsert before the pipeline runs
  --out-dir <dir>          Output directory for QA reports. Default: docs/data
  --with-forms          Run noun morphology generation as part of the pipeline
  --dry-run                Execute read/validation steps without rewriting pack files
  -h, --help               Show this help message
`;

function parseArgs(argv) {
  handleCliHelp(argv, HELP_TEXT);
  const options = {
    packDir: DEFAULT_PACK_DIR,
    entriesPath: null,
    outDir: DEFAULT_OUT_DIR,
    dryRun: false,
    withForms: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--pack-dir') options.packDir = argv[++i];
    else if (arg === '--entries') options.entriesPath = argv[++i];
    else if (arg === '--out-dir') options.outDir = argv[++i];
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--with-forms') options.withForms = true;
  }

  return options;
}

function runNodeScript(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`Script failed: ${path.basename(scriptPath)}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const toolsDir = import.meta.dirname;
  const packDir = path.resolve(options.packDir);
  const entriesPath = options.entriesPath ? path.resolve(options.entriesPath) : null;
  const outDir = path.resolve(options.outDir);

  if (entriesPath) {
    const upsertArgs = ['--pack-dir', packDir, '--entries', entriesPath];
    if (options.dryRun) {
      upsertArgs.push('--dry-run');
    }
    runNodeScript(path.join(toolsDir, 'upsert_pack_entries.mjs'), upsertArgs);
  }

  if (options.dryRun) {
    runNodeScript(path.join(toolsDir, 'sanitize_pack_legacy_markers.mjs'), [
      '--pack-dir',
      packDir,
      '--dry-run',
    ]);
    runNodeScript(path.join(toolsDir, 'quality_clean_pack.mjs'), [
      '--pack-dir',
      packDir,
      '--out-dir',
      outDir,
    ]);
    if (options.withForms) {
      runNodeScript(path.join(toolsDir, 'generate_pack_forms.mjs'), [
        '--pack-dir',
        packDir,
        '--dry-run',
      ]);
    }
    console.log('Dry-run pipeline completed (no pack files were rewritten).');
    return;
  }

  runNodeScript(path.join(toolsDir, 'curate_pack_metadata.mjs'), [
    '--pack-dir',
    packDir,
  ]);

  runNodeScript(path.join(toolsDir, 'sanitize_pack_legacy_markers.mjs'), [
    '--pack-dir',
    packDir,
  ]);

  runNodeScript(path.join(toolsDir, 'quality_clean_pack.mjs'), [
    '--pack-dir',
    packDir,
    '--out-dir',
    outDir,
    '--apply',
  ]);

  if (options.withForms) {
    runNodeScript(path.join(toolsDir, 'generate_pack_forms.mjs'), [
      '--pack-dir',
      packDir,
    ]);
  }

  console.log(
    [
      'Pack pipeline completed.',
      `  pack:      ${path.relative(process.cwd(), packDir)}`,
      `  audit out: ${path.relative(process.cwd(), outDir)}`,
    ].join('\n'),
  );
}

main();

