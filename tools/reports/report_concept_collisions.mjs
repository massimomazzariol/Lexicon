import fs from 'node:fs';
import path from 'node:path';

import { handleCliHelp } from '../lib/cli_help.mjs';
import { buildConceptCollisionReport } from '../lib/concept_collisions.mjs';
import { DEFAULT_SOURCE_PACK_DIR } from '../lib/default_pack_paths.mjs';

const HELP_TEXT = `
Usage:
  pnpm node tools/reports/report_concept_collisions.mjs [options]

Options:
  --pack-dir <dir>           Pack directory to inspect. Default: packs/lexicon_source
  --lang <code>              Optional language filter, for example de, en, it
  --term <text>              Optional term filter, useful for cases like ora or spitze
  --concept-id <id>          Optional concept id filter. Repeat or use comma-separated values
  --min-pair-score <n>       Minimum pair score to show. Default: 2
  --format <table|json>      Output format. Default: table
  --limit <number>           Maximum overloaded terms and pairs to show. Default: 20
  -h, --help                 Show this help message
`;

function parseArgs(argv) {
  handleCliHelp(argv, HELP_TEXT);
  const options = {
    packDir: DEFAULT_SOURCE_PACK_DIR,
    lang: '',
    term: '',
    conceptIds: [],
    minPairScore: 2,
    format: 'table',
    limit: 20,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--pack-dir') options.packDir = argv[++index];
    else if (arg === '--lang') options.lang = String(argv[++index] ?? '').toLowerCase();
    else if (arg === '--term') options.term = argv[++index];
    else if (arg === '--concept-id') options.conceptIds.push(argv[++index]);
    else if (arg === '--min-pair-score') options.minPairScore = Number(argv[++index] ?? 2);
    else if (arg === '--format') options.format = String(argv[++index] ?? 'table').toLowerCase();
    else if (arg === '--limit') options.limit = Number(argv[++index] ?? 20);
  }

  return options;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function formatLabels(labels) {
  return ['de', 'en', 'it']
    .map((lang) => `${lang}:${labels?.[lang] ?? '-'}`)
    .join(' | ');
}

function renderOverloadedTermLine(group) {
  const concepts = group.concepts
    .map(
      (concept) =>
        `${concept.concept_id} [${concept.level} ${concept.pos}] ${formatLabels(concept.labels)}`,
    )
    .join(' ; ');
  return [
    `- ${group.lang}:${group.display_value} [concepts=${group.concept_count}]`,
    `  signals: ${group.signal_kinds.join(', ')}`,
    `  action: ${group.recommendation}`,
    `  concepts: ${concepts}`,
  ].join('\n');
}

function renderPairLine(pair) {
  const sharedValues = pair.shared_values
    .map((value) => `${value.lang}:${value.value}`)
    .join(' ; ');
  return [
    `- ${pair.left.concept_id} <-> ${pair.right.concept_id} [score=${pair.score}]`,
    `  action: ${pair.recommendation}`,
    `  shared_languages: ${pair.shared_languages.join(', ') || 'none'}`,
    `  shared_values: ${sharedValues || 'none'}`,
    `  left: ${formatLabels(pair.left.labels)} [${pair.left.level} ${pair.left.pos}]`,
    `  right: ${formatLabels(pair.right.labels)} [${pair.right.level} ${pair.right.pos}]`,
  ].join('\n');
}

function renderTable(summary, manifest) {
  const lines = [
    `pack: ${manifest.pack_id}`,
    `version: ${manifest.version}`,
    `filters: lang=${summary.filters.lang ?? 'all'} term=${summary.filters.term ?? 'all'} concept_ids=${summary.filters.concept_ids.join(',') || 'all'} min_pair_score=${summary.filters.min_pair_score} limit=${summary.filters.limit}`,
    `totals: overloaded_terms=${summary.totals.overloaded_term_groups} pair_candidates=${summary.totals.pair_candidates}`,
  ];

  if (summary.filters.missing_requested_concept_ids.length > 0) {
    lines.push(
      `missing_requested_concept_ids: ${summary.filters.missing_requested_concept_ids.join(', ')}`,
    );
  }

  lines.push('overloaded_terms:');
  if (summary.overloaded_terms.length === 0) {
    lines.push('none');
  } else {
    for (const group of summary.overloaded_terms) {
      lines.push(renderOverloadedTermLine(group));
    }
  }

  lines.push('pair_candidates:');
  if (summary.pair_candidates.length === 0) {
    lines.push('none');
  } else {
    for (const pair of summary.pair_candidates) {
      lines.push(renderPairLine(pair));
    }
  }

  return lines.join('\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packDir = path.resolve(options.packDir);
  const manifest = readJson(path.join(packDir, 'manifest.json'));
  const content = readJson(path.join(packDir, 'content.json'));

  const summary = buildConceptCollisionReport({
    manifest,
    content,
    lang: options.lang,
    term: options.term,
    conceptIds: options.conceptIds,
    limit: Number.isFinite(options.limit) ? options.limit : 20,
    minPairScore: Number.isFinite(options.minPairScore) ? options.minPairScore : 2,
  });

  if (options.format === 'json') {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(renderTable(summary, manifest));
}

main();
