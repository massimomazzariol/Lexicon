import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { handleCliHelp } from '../lib/cli_help.mjs';
import { DEFAULT_SOURCE_PACK_DIR } from '../lib/default_pack_paths.mjs';

const HELP_TEXT = `
Usage:
  pnpm node tools/reports/report_answer_support_drift.mjs [options]

Options:
  --pack-dir <dir>           Source pack directory to inspect. Default: packs/lexicon_source
  --templates-dir <dir>      Editorial templates directory. Default: packs/templates
  --template <name>          Restrict to a specific template filename. Repeatable.
  --lang <lang>              Restrict to a language, for example de or it
  --format <table|json>      Output format. Default: table
  --limit <number>           Maximum drift rows to show. Default: 25
  --include-sample           Include sample/request templates that are skipped by default
  -h, --help                 Show this help message
`;

const DEFAULT_TEMPLATES_DIR = 'packs/templates';
const DEFAULT_LIMIT = 25;
const DEFAULT_SKIPPED_TEMPLATE_NAMES = new Set([
  'entries.sample.json',
  'entries.german_request_terms.json',
]);
const VALID_POS = new Set(['noun', 'verb', 'adj', 'adv', 'chunk']);

function parseArgs(argv) {
  handleCliHelp(argv, HELP_TEXT);
  const options = {
    packDir: DEFAULT_SOURCE_PACK_DIR,
    templatesDir: DEFAULT_TEMPLATES_DIR,
    templates: [],
    lang: '',
    format: 'table',
    limit: DEFAULT_LIMIT,
    includeSample: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--pack-dir') options.packDir = argv[++index];
    else if (arg === '--templates-dir') options.templatesDir = argv[++index];
    else if (arg === '--template') options.templates.push(String(argv[++index] ?? ''));
    else if (arg === '--lang') options.lang = String(argv[++index] ?? '').trim().toLowerCase();
    else if (arg === '--format') options.format = String(argv[++index] ?? 'table').trim().toLowerCase();
    else if (arg === '--limit') options.limit = Number(argv[++index] ?? DEFAULT_LIMIT);
    else if (arg === '--include-sample') options.includeSample = true;
  }

  return options;
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeOptional(value) {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

function normalizePos(value) {
  const normalized = normalizeText(value).toLowerCase();
  return VALID_POS.has(normalized) ? normalized : 'chunk';
}

function deterministicUuid(seed) {
  const hash = crypto.createHash('sha1').update(seed).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function mergeUniqueStrings(...groups) {
  const output = [];
  const seen = new Set();
  for (const group of groups) {
    const values = Array.isArray(group) ? group : group == null ? [] : [group];
    for (const value of values) {
      const normalized = normalizeOptional(value);
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(normalized);
    }
  }
  return output;
}

function parseTemplateAliases(translation) {
  if (!translation || typeof translation !== 'object' || Array.isArray(translation)) {
    return [];
  }
  return mergeUniqueStrings(
    translation.aliases,
    translation.synonyms,
    translation.card_synonyms,
    translation.cardSynonyms,
  );
}

function collectTemplateFiles(templatesDir, options) {
  const requested = new Set(options.templates.filter(Boolean));
  const all = fs
    .readdirSync(templatesDir)
    .filter((entry) => entry.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right));

  return all.filter((fileName) => {
    if (!options.includeSample && DEFAULT_SKIPPED_TEMPLATE_NAMES.has(fileName)) {
      return false;
    }
    if (requested.size === 0) {
      return true;
    }
    return requested.has(fileName);
  });
}

function buildSupportIndexes(content) {
  const conceptById = new Map();
  const primaryLexemeByConceptLang = new Map();
  const exactSupportByConceptLang = new Map();
  const synonymSupportByConceptLang = new Map();

  for (const concept of content.concepts ?? []) {
    if (concept?.concept_id) {
      conceptById.set(concept.concept_id, concept);
    }
  }

  for (const definition of content.concept_definitions ?? []) {
    const conceptId = normalizeOptional(definition?.concept_id);
    const lang = normalizeOptional(definition?.lang)?.toLowerCase();
    if (!conceptId || !lang) continue;
    synonymSupportByConceptLang.set(
      `${conceptId}::${lang}`,
      mergeUniqueStrings(definition.synonyms_json),
    );
  }

  for (const lexeme of content.lexemes ?? []) {
    const conceptId = normalizeOptional(lexeme?.concept_id);
    const lang = normalizeOptional(lexeme?.lang)?.toLowerCase();
    const text = normalizeOptional(lexeme?.text);
    if (!conceptId || !lang || !text) continue;

    const key = `${conceptId}::${lang}`;
    if (lexeme.is_primary === true || !primaryLexemeByConceptLang.has(key)) {
      primaryLexemeByConceptLang.set(key, text);
    }

    const active = lexeme.is_active !== false;
    const status = normalizeOptional(lexeme.status)?.toLowerCase() ?? 'approved';
    const meaningStatus =
      normalizeOptional(lexeme.meaning_status)?.toLowerCase() ?? 'exact';
    if (!active || status !== 'approved' || meaningStatus !== 'exact') {
      continue;
    }

    exactSupportByConceptLang.set(
      key,
      mergeUniqueStrings(exactSupportByConceptLang.get(key) ?? [], text),
    );
  }

  return {
    conceptById,
    primaryLexemeByConceptLang,
    exactSupportByConceptLang,
    synonymSupportByConceptLang,
  };
}

function buildDriftReport({ content, templateFiles, templatesDir, langFilter }) {
  const {
    conceptById,
    primaryLexemeByConceptLang,
    exactSupportByConceptLang,
    synonymSupportByConceptLang,
  } = buildSupportIndexes(content);

  const driftRows = [];
  const skippedNonArrayFiles = [];
  let entriesScanned = 0;
  let aliasBearingRows = 0;

  for (const fileName of templateFiles) {
    const filePath = path.join(templatesDir, fileName);
    const entries = readJson(filePath);
    if (!Array.isArray(entries)) {
      skippedNonArrayFiles.push(fileName);
      continue;
    }

    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      entriesScanned += 1;
      const pos = normalizePos(entry.pos);
      const sourceKey =
        normalizeOptional(entry.source_key) ??
        normalizeOptional(entry.key) ??
        normalizeOptional(entry.concept_id);
      if (!sourceKey) {
        continue;
      }
      const conceptId =
        normalizeOptional(entry.concept_id) ??
        deterministicUuid(`concept:${sourceKey.toLowerCase()}:${pos}`);
      const concept = conceptById.get(conceptId);
      if (!concept) {
        continue;
      }

      const translations =
        entry.translations && typeof entry.translations === 'object'
          ? entry.translations
          : null;
      if (!translations) {
        continue;
      }

      for (const [langRaw, translation] of Object.entries(translations)) {
        const lang = normalizeOptional(langRaw)?.toLowerCase();
        if (!lang) {
          continue;
        }
        if (langFilter && lang !== langFilter) {
          continue;
        }
        const aliases = parseTemplateAliases(translation);
        if (aliases.length === 0) {
          continue;
        }
        aliasBearingRows += 1;

        const key = `${conceptId}::${lang}`;
        const support = mergeUniqueStrings(
          synonymSupportByConceptLang.get(key) ?? [],
          exactSupportByConceptLang.get(key) ?? [],
        );
        const supportLookup = new Set(support.map((value) => value.toLowerCase()));
        const missing = aliases.filter(
          (value) => !supportLookup.has(value.toLowerCase()),
        );
        if (missing.length === 0) {
          continue;
        }

        driftRows.push({
          template_file: fileName,
          concept_id: conceptId,
          source_key: sourceKey,
          level: concept.level_override ?? concept.level_auto ?? null,
          pos: concept.pos ?? pos,
          lang,
          primary_text: primaryLexemeByConceptLang.get(key) ?? null,
          template_aliases: aliases,
          missing_support: missing,
          live_support: support,
        });
      }
    }
  }

  driftRows.sort((left, right) => {
    return (
      left.template_file.localeCompare(right.template_file) ||
      String(left.level ?? '').localeCompare(String(right.level ?? '')) ||
      left.source_key.localeCompare(right.source_key) ||
      left.lang.localeCompare(right.lang)
    );
  });

  const driftConcepts = new Set(driftRows.map((row) => row.concept_id));
  const driftTemplateFiles = new Set(driftRows.map((row) => row.template_file));
  const countsByTemplate = Object.fromEntries(
    [...driftTemplateFiles]
      .sort((left, right) => left.localeCompare(right))
      .map((fileName) => [
        fileName,
        driftRows.filter((row) => row.template_file === fileName).length,
      ]),
  );

  return {
    totals: {
      template_files_scanned: templateFiles.length,
      entries_scanned: entriesScanned,
      alias_bearing_rows_scanned: aliasBearingRows,
      drift_rows: driftRows.length,
      drift_concepts: driftConcepts.size,
      drift_template_files: driftTemplateFiles.size,
    },
    filters: {
      lang: langFilter || null,
    },
    skipped_non_array_files: skippedNonArrayFiles,
    drift_counts_by_template: countsByTemplate,
    drift_rows: driftRows,
  };
}

function renderTable(report, manifest, options) {
  const lines = [
    `pack: ${manifest.pack_id}`,
    `version: ${manifest.version}`,
    `filters: lang=${report.filters.lang ?? 'all'} limit=${options.limit}`,
    `totals: templates=${report.totals.template_files_scanned} entries=${report.totals.entries_scanned} alias_rows=${report.totals.alias_bearing_rows_scanned} drift_rows=${report.totals.drift_rows} drift_concepts=${report.totals.drift_concepts}`,
  ];

  const topTemplates = Object.entries(report.drift_counts_by_template)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10)
    .map(([fileName, count]) => `${fileName}=${count}`);
  lines.push(`top_templates: ${topTemplates.join(' ') || 'none'}`);

  const visibleRows = report.drift_rows.slice(0, options.limit);
  if (visibleRows.length === 0) {
    lines.push('drifts: none');
    return lines.join('\n');
  }

  lines.push('drifts:');
  for (const row of visibleRows) {
    lines.push(
      `- ${row.template_file} | ${row.level ?? '-'} ${row.pos} | ${row.lang} | ${row.source_key}`,
    );
    lines.push(`  primary: ${row.primary_text ?? '-'}`);
    lines.push(`  missing: ${row.missing_support.join(' ; ')}`);
    lines.push(`  live: ${row.live_support.join(' ; ') || '-'}`);
  }

  if (report.drift_rows.length > visibleRows.length) {
    lines.push(
      `... ${report.drift_rows.length - visibleRows.length} more drift rows omitted`,
    );
  }

  return lines.join('\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packDir = path.resolve(options.packDir);
  const templatesDir = path.resolve(options.templatesDir);

  const manifest = readJson(path.join(packDir, 'manifest.json'));
  const content = readJson(path.join(packDir, 'content.json'));
  const templateFiles = collectTemplateFiles(templatesDir, options);
  const report = buildDriftReport({
    content,
    templateFiles,
    templatesDir,
    langFilter: options.lang,
  });

  if (options.format === 'json') {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(renderTable(report, manifest, options));
}

main();
