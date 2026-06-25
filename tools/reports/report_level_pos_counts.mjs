import fs from 'node:fs';
import path from 'node:path';

import { handleCliHelp } from '../lib/cli_help.mjs';
import { DEFAULT_SOURCE_PACK_DIR } from '../lib/default_pack_paths.mjs';
import {
  DEFAULT_LEXICON_LEVEL,
  LEXICON_LEVELS,
  normalizeLexiconLevel,
} from '../lib/lexicon_conventions.mjs';

const PREFERRED_POS_ORDER = ['noun', 'verb', 'adj', 'adv', 'chunk'];
const HELP_TEXT = `
Usage:
  pnpm node tools/reports/report_level_pos_counts.mjs [options]

Options:
  --pack-dir <dir>         Pack directory to inspect. Default: packs/lexicon_source
  --format <table|json>    Output format. Default: table
  --no-zero-levels         Hide levels with zero concepts
  -h, --help               Show this help message
`;

function parseArgs(argv) {
  handleCliHelp(argv, HELP_TEXT);
  const options = {
    packDir: DEFAULT_SOURCE_PACK_DIR,
    format: 'table',
    includeZeroLevels: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--pack-dir') options.packDir = argv[++i];
    else if (arg === '--format') options.format = String(argv[++i] ?? 'table').toLowerCase();
    else if (arg === '--no-zero-levels') options.includeZeroLevels = false;
  }

  return options;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeLevel(value) {
  return normalizeLexiconLevel(value) ?? DEFAULT_LEXICON_LEVEL;
}

function normalizePos(value) {
  const normalized = normalizeText(value).toLowerCase();
  return normalized.length > 0 ? normalized : 'unknown';
}

function buildEmptyBucket() {
  return {
    total: 0,
    pos: {},
  };
}

function collectCounts(concepts) {
  const byLevel = new Map();
  const posSet = new Set();

  for (const concept of concepts) {
    const level = normalizeLevel(concept.level_override ?? concept.level_auto);
    const pos = normalizePos(concept.pos);
    const bucket = byLevel.get(level) ?? buildEmptyBucket();
    bucket.total += 1;
    bucket.pos[pos] = (bucket.pos[pos] ?? 0) + 1;
    byLevel.set(level, bucket);
    posSet.add(pos);
  }

  return { byLevel, posSet };
}

function orderedPosColumns(posSet) {
  const extras = [...posSet]
    .filter((pos) => !PREFERRED_POS_ORDER.includes(pos))
    .sort((left, right) => left.localeCompare(right));
  return [...PREFERRED_POS_ORDER, ...extras];
}

function toSummary(manifest, byLevel, posColumns, includeZeroLevels) {
  const levels = {};
  for (const level of LEXICON_LEVELS) {
    const bucket = byLevel.get(level) ?? buildEmptyBucket();
    if (!includeZeroLevels && bucket.total === 0) {
      continue;
    }
    levels[level] = {
      total: bucket.total,
      pos: Object.fromEntries(
        posColumns.map((pos) => [pos, bucket.pos[pos] ?? 0]),
      ),
    };
  }

  return {
    pack_id: manifest.pack_id,
    version: manifest.version,
    levels,
  };
}

function renderTable(summary, posColumns) {
  const rows = [];
  const headers = ['level', ...posColumns, 'total'];
  rows.push(headers);

  for (const level of LEXICON_LEVELS) {
    const bucket = summary.levels[level];
    if (!bucket) continue;
    rows.push([
      level,
      ...posColumns.map((pos) => String(bucket.pos[pos] ?? 0)),
      String(bucket.total),
    ]);
  }

  const widths = headers.map((_, columnIndex) =>
    Math.max(...rows.map((row) => row[columnIndex].length)),
  );

  return rows
    .map((row, rowIndex) => {
      const line = row
        .map((cell, columnIndex) => cell.padEnd(widths[columnIndex]))
        .join('  ');
      if (rowIndex === 0) {
        const divider = widths.map((width) => '-'.repeat(width)).join('  ');
        return `${line}\n${divider}`;
      }
      return line;
    })
    .join('\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packDir = path.resolve(options.packDir);
  const manifest = readJson(path.join(packDir, 'manifest.json'));
  const content = readJson(path.join(packDir, 'content.json'));
  const concepts = Array.isArray(content.concepts) ? content.concepts : [];

  const { byLevel, posSet } = collectCounts(concepts);
  const posColumns = orderedPosColumns(posSet);
  const summary = toSummary(
    manifest,
    byLevel,
    posColumns,
    options.includeZeroLevels,
  );

  if (options.format === 'json') {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(
    [
      `pack: ${summary.pack_id}`,
      `version: ${summary.version}`,
      renderTable(summary, posColumns),
    ].join('\n'),
  );
}

main();
