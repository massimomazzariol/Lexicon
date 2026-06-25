import fs from 'node:fs';
import path from 'node:path';

import { handleCliHelp } from '../lib/cli_help.mjs';
import { DEFAULT_SOURCE_PACK_DIR } from '../lib/default_pack_paths.mjs';
import { buildGenerateBrief } from '../lib/generate_brief.mjs';
import { renderGenerateBriefTable } from '../lib/generate_workflow_output.mjs';

const HELP_TEXT = `
Usage:
  pnpm node tools/reports/report_generate_brief.mjs --term <word> [options]

Options:
  --pack-dir <dir>           Pack directory to inspect. Default: packs/lexicon_source
  --term <text>              Term, lemma, or surface form to inspect
  --lang <code>              Optional language filter, for example de, en, it
  --concept-limit <number>   Maximum core concept candidates. Default: 4
  --collision-limit <number> Maximum collision rows to keep. Default: 8
  --format <table|json>      Output format. Default: table
  -h, --help                 Show this help message
`;

function parseArgs(argv) {
  handleCliHelp(argv, HELP_TEXT);
  const options = {
    packDir: DEFAULT_SOURCE_PACK_DIR,
    term: '',
    lang: '',
    conceptLimit: 4,
    collisionLimit: 8,
    format: 'table',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--pack-dir') options.packDir = argv[++index];
    else if (arg === '--term') options.term = argv[++index];
    else if (arg === '--lang') options.lang = String(argv[++index] ?? '').toLowerCase();
    else if (arg === '--concept-limit') options.conceptLimit = Number(argv[++index] ?? 4);
    else if (arg === '--collision-limit') options.collisionLimit = Number(argv[++index] ?? 8);
    else if (arg === '--format') options.format = String(argv[++index] ?? 'table').toLowerCase();
  }

  if (!String(options.term ?? '').trim()) {
    throw new Error('Missing --term <word>.');
  }

  return options;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packDir = path.resolve(options.packDir);
  const manifest = readJson(path.join(packDir, 'manifest.json'));
  const content = readJson(path.join(packDir, 'content.json'));

  const summary = buildGenerateBrief({
    manifest,
    content,
    term: options.term,
    lang: options.lang,
    conceptLimit: Number.isFinite(options.conceptLimit) ? options.conceptLimit : 4,
    collisionLimit: Number.isFinite(options.collisionLimit) ? options.collisionLimit : 8,
  });

  if (options.format === 'json') {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(renderGenerateBriefTable(summary, manifest));
}

main();
