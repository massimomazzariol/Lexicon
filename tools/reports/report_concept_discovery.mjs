import fs from 'node:fs';
import path from 'node:path';

import { handleCliHelp } from '../lib/cli_help.mjs';
import { discoverConcepts } from '../lib/concept_discovery.mjs';
import { DEFAULT_SOURCE_PACK_DIR } from '../lib/default_pack_paths.mjs';

const HELP_TEXT = `
Usage:
  pnpm node tools/reports/report_concept_discovery.mjs --term <word> [options]

Options:
  --pack-dir <dir>         Pack directory to inspect. Default: packs/lexicon_source
  --term <text>            Term, lemma, or surface form to inspect
  --lang <code>            Optional language filter, for example de, en, it
  --format <table|json>    Output format. Default: table
  --limit <number>         Maximum concepts to show. Default: 8
  -h, --help               Show this help message
`;

function parseArgs(argv) {
  handleCliHelp(argv, HELP_TEXT);
  const options = {
    packDir: DEFAULT_SOURCE_PACK_DIR,
    term: '',
    lang: '',
    format: 'table',
    limit: 8,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--pack-dir') options.packDir = argv[++index];
    else if (arg === '--term') options.term = argv[++index];
    else if (arg === '--lang') options.lang = String(argv[++index] ?? '').toLowerCase();
    else if (arg === '--format') options.format = String(argv[++index] ?? 'table').toLowerCase();
    else if (arg === '--limit') options.limit = Number(argv[++index] ?? 8);
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

function renderConceptLine(concept) {
  const labels = ['de', 'en', 'it']
    .map((lang) => `${lang}:${concept.labels?.[lang] ?? '-'}`)
    .join(' | ');
  const matchSummary = [...new Set(
    concept.matches.map((row) => `${row.match_kind}:${row.lang}:${row.value}`),
  )]
    .slice(0, 4)
    .join(' ; ');
  const gaps = [
    concept.coverage.missing_lexeme_langs.length > 0
      ? `missing lexeme ${concept.coverage.missing_lexeme_langs.join(',')}`
      : null,
    concept.coverage.missing_definition_langs.length > 0
      ? `missing def ${concept.coverage.missing_definition_langs.join(',')}`
      : null,
    concept.coverage.missing_example_langs.length > 0
      ? `missing ex ${concept.coverage.missing_example_langs.join(',')}`
      : null,
  ]
    .filter(Boolean)
    .join(' | ');

  return [
    `- ${concept.concept_id} [${concept.level} ${concept.pos}]`,
    `  labels: ${labels}`,
    `  action: ${concept.recommended_action}`,
    `  matches: ${matchSummary || 'none'}`,
    `  coverage: ${concept.coverage_status}${gaps ? ` (${gaps})` : ''}`,
  ].join('\n');
}

function renderTable(summary, manifest) {
  const lines = [
    `pack: ${manifest.pack_id}`,
    `version: ${manifest.version}`,
    `term: ${summary.input.term}`,
    `lang: ${summary.input.lang}`,
    `recommendation: ${summary.overall_recommendation}`,
    `matches: exact=${summary.exact_match_count} support=${summary.support_match_count} close=${summary.close_match_count}`,
  ];

  if (summary.concepts.length === 0) {
    lines.push('concepts: none');
    return lines.join('\n');
  }

  lines.push('concepts:');
  for (const concept of summary.concepts) {
    lines.push(renderConceptLine(concept));
  }
  return lines.join('\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packDir = path.resolve(options.packDir);
  const manifest = readJson(path.join(packDir, 'manifest.json'));
  const content = readJson(path.join(packDir, 'content.json'));

  const summary = discoverConcepts({
    manifest,
    content,
    term: options.term,
    lang: options.lang,
    partialLimit: Number.isFinite(options.limit) ? options.limit : 8,
  });

  if (options.format === 'json') {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(renderTable(summary, manifest));
}

main();
