import fs from 'node:fs';
import path from 'node:path';

import { handleCliHelp } from '../lib/cli_help.mjs';
import { DEFAULT_SOURCE_PACK_DIR } from '../lib/default_pack_paths.mjs';

const DEFAULT_PACK_DIR = DEFAULT_SOURCE_PACK_DIR;
const HELP_TEXT = `
Usage:
  pnpm node tools/pipeline/sanitize_pack_legacy_markers.mjs [options]

Options:
  --pack-dir <dir>         Canonical source pack directory. Default: packs/lexicon_source
  --dry-run                Report legacy-marker cleanup without rewriting files
  -h, --help               Show this help message
`;

function parseArgs(argv) {
  handleCliHelp(argv, HELP_TEXT);
  const options = {
    packDir: DEFAULT_PACK_DIR,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--pack-dir') options.packDir = argv[++i];
    else if (arg === '--dry-run') options.dryRun = true;
  }

  return options;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packDir = path.resolve(options.packDir);
  const manifestPath = path.join(packDir, 'manifest.json');
  const contentPath = path.join(packDir, 'content.json');

  const manifest = readJson(manifestPath);
  const content = readJson(contentPath);
  const concepts = Array.isArray(content.concepts) ? content.concepts : [];

  let conceptsTouched = 0;
  let removedLegacyWordKey = 0;
  let removedLevelSource = 0;

  for (const concept of concepts) {
    const metadata = concept?.metadata_json;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      continue;
    }

    let conceptChanged = false;
    if (Object.prototype.hasOwnProperty.call(metadata, 'legacy_word_key')) {
      delete metadata.legacy_word_key;
      removedLegacyWordKey += 1;
      conceptChanged = true;
    }
    if (Object.prototype.hasOwnProperty.call(metadata, 'level_source')) {
      delete metadata.level_source;
      removedLevelSource += 1;
      conceptChanged = true;
    }

    if (conceptChanged) {
      conceptsTouched += 1;
    }
  }

  const removedSourceFile = Object.prototype.hasOwnProperty.call(
    manifest,
    'source_file',
  );
  if (removedSourceFile) {
    delete manifest.source_file;
  }

  if (!options.dryRun) {
    writeJson(contentPath, content);
    writeJson(manifestPath, manifest);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        packDir,
        dryRun: options.dryRun,
        conceptsTouched,
        removedLegacyWordKey,
        removedLevelSource,
        removedSourceFile,
      },
      null,
      2,
    ),
  );
}

main();

