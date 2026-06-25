import fs from 'node:fs';
import path from 'node:path';

import { handleCliHelp } from '../lib/cli_help.mjs';
import { buildConceptCoverageMatrix } from '../lib/concept_coverage.mjs';
import { DEFAULT_SOURCE_PACK_DIR } from '../lib/default_pack_paths.mjs';

const HELP_TEXT = `
Usage:
  pnpm node tools/reports/report_concept_coverage_matrix.mjs [options]

Options:
  --pack-dir <dir>           Pack directory to inspect. Default: packs/lexicon_source
  --concept-id <id>          Specific concept id to inspect. Repeat or use comma-separated values
  --level <level>            Optional level filter, for example A1 or B1
  --pos <pos>                Optional part-of-speech filter, for example noun or verb
  --only-incomplete          Show only concepts with missing core coverage
  --format <table|json>      Output format. Default: table
  --limit <number>           Maximum concepts to show. Default: 25
  -h, --help                 Show this help message
`;

function parseArgs(argv) {
  handleCliHelp(argv, HELP_TEXT);
  const options = {
    packDir: DEFAULT_SOURCE_PACK_DIR,
    conceptIds: [],
    level: '',
    pos: '',
    onlyIncomplete: false,
    format: 'table',
    limit: 25,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--pack-dir') options.packDir = argv[++index];
    else if (arg === '--concept-id') options.conceptIds.push(argv[++index]);
    else if (arg === '--level') options.level = String(argv[++index] ?? '').toUpperCase();
    else if (arg === '--pos') options.pos = String(argv[++index] ?? '').toLowerCase();
    else if (arg === '--only-incomplete') options.onlyIncomplete = true;
    else if (arg === '--format') options.format = String(argv[++index] ?? 'table').toLowerCase();
    else if (arg === '--limit') options.limit = Number(argv[++index] ?? 25);
  }

  return options;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function formatPresenceRow(name, matrix, languages) {
  const cells = languages.map((lang) => `${lang}:${matrix[lang] ? 'Y' : '-'}`).join(' ');
  return `${name}[${cells}]`;
}

function renderConceptLine(concept, languages) {
  const labels = ['de', 'en', 'it']
    .filter((lang) => languages.includes(lang))
    .map((lang) => `${lang}:${concept.labels?.[lang] ?? '-'}`)
    .join(' | ');
  const missingBits = [
    concept.coverage.missing_lexeme_langs.length > 0
      ? `lex ${concept.coverage.missing_lexeme_langs.join(',')}`
      : null,
    concept.coverage.missing_definition_langs.length > 0
      ? `def ${concept.coverage.missing_definition_langs.join(',')}`
      : null,
    concept.coverage.missing_example_langs.length > 0
      ? `ex ${concept.coverage.missing_example_langs.join(',')}`
      : null,
    concept.coverage.missing_core_form_langs.length > 0
      ? `forms ${concept.coverage.missing_core_form_langs.join(',')}`
      : null,
  ]
    .filter(Boolean)
    .join(' | ');

  return [
    `- ${concept.concept_id} [${concept.level} ${concept.pos}]`,
    `  labels: ${labels || 'none'}`,
    `  matrix: ${formatPresenceRow('lex', concept.matrix.lexemes, languages)} ${formatPresenceRow('def', concept.matrix.definitions, languages)} ${formatPresenceRow('ex', concept.matrix.examples, languages)} ${formatPresenceRow('forms', concept.matrix.core_forms, languages)}`,
    `  support: ${formatPresenceRow('syn', concept.matrix.synonyms, languages)} ${formatPresenceRow('ant', concept.matrix.antonyms, languages)} ${formatPresenceRow('policy', concept.matrix.antonym_policy, languages)}`,
    `  status: ${concept.coverage_status}${missingBits ? ` (${missingBits})` : ''}`,
    `  action: ${concept.recommended_action}`,
  ].join('\n');
}

function renderTable(summary, manifest) {
  const lines = [
    `pack: ${manifest.pack_id}`,
    `version: ${manifest.version}`,
    `languages: ${summary.languages.join(', ')}`,
    `filters: concept_ids=${summary.filters.concept_ids.join(',') || 'all'} level=${summary.filters.level ?? 'all'} pos=${summary.filters.pos ?? 'all'} only_incomplete=${summary.filters.only_incomplete ? 'yes' : 'no'} limit=${summary.filters.limit}`,
    `totals: matching=${summary.totals.matching_concepts} returned=${summary.totals.returned_concepts} incomplete=${summary.totals.incomplete_concepts}`,
    `status_counts: ${Object.entries(summary.totals.status_counts)
      .map(([status, count]) => `${status}=${count}`)
      .join(' ') || 'none'}`,
  ];

  if (summary.filters.missing_requested_concept_ids.length > 0) {
    lines.push(
      `missing_requested_concept_ids: ${summary.filters.missing_requested_concept_ids.join(', ')}`,
    );
  }

  if (summary.concepts.length === 0) {
    lines.push('concepts: none');
    return lines.join('\n');
  }

  lines.push('concepts:');
  for (const concept of summary.concepts) {
    lines.push(renderConceptLine(concept, summary.languages));
  }
  return lines.join('\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packDir = path.resolve(options.packDir);
  const manifest = readJson(path.join(packDir, 'manifest.json'));
  const content = readJson(path.join(packDir, 'content.json'));

  const summary = buildConceptCoverageMatrix({
    manifest,
    content,
    conceptIds: options.conceptIds,
    level: options.level,
    pos: options.pos,
    onlyIncomplete: options.onlyIncomplete,
    limit: Number.isFinite(options.limit) ? options.limit : 25,
  });

  if (options.format === 'json') {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(renderTable(summary, manifest));
}

main();
