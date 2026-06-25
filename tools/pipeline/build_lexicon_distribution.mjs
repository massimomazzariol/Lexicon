import path from 'node:path';

import { handleCliHelp } from '../lib/cli_help.mjs';
import { buildLexiconDistribution } from '../lib/lexicon_distribution_builder.mjs';

const HELP_TEXT = `
Usage:
  pnpm node tools/pipeline/build_lexicon_distribution.mjs [options]

Options:
  --packs-root <dir>       Root directory containing runtime packs. Default: packs
  --out-dir <dir>          Output directory for distribution artifacts. Default: dist/lexicon_distribution
  --generated-at <iso>     Override generated timestamp for manifest output
  -h, --help               Show this help message
`;

function parseArgs(argv) {
  handleCliHelp(argv, HELP_TEXT);
  const options = {
    packsRoot: 'packs',
    outDir: 'dist/lexicon_distribution',
    generatedAt: new Date().toISOString(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--packs-root') {
      options.packsRoot = argv[++i];
    } else if (arg === '--out-dir') {
      options.outDir = argv[++i];
    } else if (arg === '--generated-at') {
      options.generatedAt = argv[++i];
    }
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = buildLexiconDistribution({
    packsRoot: path.resolve(options.packsRoot),
    outDir: path.resolve(options.outDir),
    generatedAt: options.generatedAt,
  });

  console.log(
    [
      `generated_at=${result.generatedAt}`,
      `runtime_packs=${result.runtimePackCount}`,
      `languages=${result.languageCount}`,
      `root_manifest=${result.rootManifestPath}`,
    ].join(' '),
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
