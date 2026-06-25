import fs from 'node:fs';
import path from 'node:path';

import { handleCliHelp } from '../lib/cli_help.mjs';
import { DEFAULT_SOURCE_PACK_DIR } from '../lib/default_pack_paths.mjs';
import {
  DEFAULT_LEXICON_LEVEL,
  LEXICON_LEVELS,
  normalizeLexiconLevel,
} from '../lib/lexicon_conventions.mjs';

const HELP_TEXT = `
Usage:
  pnpm node tools/reports/report_level_lemmas.mjs [options]

Options:
  --pack-dir <dir>         Pack directory to inspect. Default: packs/lexicon_source
  --lang <code>            Lexeme language to list. Default: de
  --pos <part-of-speech>   Optional part of speech filter
  --format <table|json>    Output format. Default: table
  --limit <number>         Optional per-level lemma limit. Default: 0 (no limit)
  --no-zero-levels         Hide levels with zero lemmas
  -h, --help               Show this help message
`;

function parseArgs(argv) {
  handleCliHelp(argv, HELP_TEXT);
  const options = {
    packDir: DEFAULT_SOURCE_PACK_DIR,
    lang: 'de',
    pos: '',
    format: 'table',
    includeZeroLevels: true,
    limit: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--pack-dir') options.packDir = argv[++i];
    else if (arg === '--lang') options.lang = String(argv[++i] ?? 'de').toLowerCase();
    else if (arg === '--pos') options.pos = String(argv[++i] ?? '').toLowerCase();
    else if (arg === '--format') options.format = String(argv[++i] ?? 'table').toLowerCase();
    else if (arg === '--limit') options.limit = Number(argv[++i] ?? 0);
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
  return normalizeText(value).toLowerCase();
}

function isApprovedLexeme(row) {
  if (!row || row.is_active === false) return false;
  return normalizeText(row.status).toLowerCase() !== 'deprecated';
}

function compareLexemes(left, right) {
  if ((left.is_primary === true) !== (right.is_primary === true)) {
    return left.is_primary === true ? -1 : 1;
  }
  const leftMeaning = normalizeText(left.meaning_status).toLowerCase();
  const rightMeaning = normalizeText(right.meaning_status).toLowerCase();
  if ((leftMeaning === 'exact') !== (rightMeaning === 'exact')) {
    return leftMeaning === 'exact' ? -1 : 1;
  }
  return normalizeText(left.text).localeCompare(normalizeText(right.text));
}

function buildConceptIndex(concepts) {
  return new Map(
    concepts.map((concept) => [
      concept.concept_id,
      {
        concept_id: concept.concept_id,
        pos: normalizePos(concept.pos),
        level: normalizeLevel(concept.level_override ?? concept.level_auto),
      },
    ]),
  );
}

function groupLexemesByConcept(lexemes, conceptIndex, lang, posFilter) {
  const grouped = new Map();

  for (const lexeme of lexemes) {
    if (!isApprovedLexeme(lexeme)) continue;
    if (normalizeText(lexeme.lang).toLowerCase() !== lang) continue;

    const concept = conceptIndex.get(lexeme.concept_id);
    if (!concept) continue;
    if (posFilter && concept.pos !== posFilter) continue;

    const bucket = grouped.get(lexeme.concept_id) ?? [];
    bucket.push(lexeme);
    grouped.set(lexeme.concept_id, bucket);
  }

  return grouped;
}

function collectLemmas(groupedLexemes, conceptIndex) {
  const buckets = new Map(LEXICON_LEVELS.map((level) => [level, []]));

  for (const [conceptId, entries] of groupedLexemes.entries()) {
    const concept = conceptIndex.get(conceptId);
    if (!concept || entries.length === 0) continue;
    const primary = [...entries].sort(compareLexemes)[0];
    const lemma = normalizeText(primary.lemma || primary.text);
    if (!lemma) continue;
    buckets.get(concept.level)?.push({
      concept_id: conceptId,
      lemma,
      pos: concept.pos,
    });
  }

  for (const level of LEXICON_LEVELS) {
    const bucket = buckets.get(level) ?? [];
    bucket.sort((left, right) => left.lemma.localeCompare(right.lemma));
    buckets.set(level, bucket);
  }

  return buckets;
}

function toSummary(manifest, buckets, options) {
  const levels = {};

  for (const level of LEXICON_LEVELS) {
    const rows = buckets.get(level) ?? [];
    if (!options.includeZeroLevels && rows.length === 0) continue;
    const limitedRows =
      options.limit > 0 ? rows.slice(0, options.limit) : rows;
    levels[level] = {
      count: rows.length,
      lemmas: limitedRows.map((row) => row.lemma),
    };
  }

  return {
    pack_id: manifest.pack_id,
    version: manifest.version,
    lang: options.lang,
    pos: options.pos || 'all',
    limit: options.limit,
    levels,
  };
}

function renderTable(summary) {
  const levelColumns = LEXICON_LEVELS.filter((level) => summary.levels[level]);
  const headers = levelColumns.map(
    (level) => `${level} (${summary.levels[level].count})`,
  );
  const rowCount = Math.max(
    0,
    ...levelColumns.map((level) => summary.levels[level].lemmas.length),
  );
  const rows = [headers];

  for (let index = 0; index < rowCount; index += 1) {
    rows.push(
      levelColumns.map((level) => summary.levels[level].lemmas[index] ?? ''),
    );
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
  const lexemes = Array.isArray(content.lexemes) ? content.lexemes : [];

  const conceptIndex = buildConceptIndex(concepts);
  const groupedLexemes = groupLexemesByConcept(
    lexemes,
    conceptIndex,
    options.lang,
    options.pos,
  );
  const buckets = collectLemmas(groupedLexemes, conceptIndex);
  const summary = toSummary(manifest, buckets, options);

  if (options.format === 'json') {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(
    [
      `pack: ${summary.pack_id}`,
      `version: ${summary.version}`,
      `lang: ${summary.lang}`,
      `pos: ${summary.pos}`,
      renderTable(summary),
    ].join('\n'),
  );
}

main();
