import fs from 'node:fs';
import path from 'node:path';

import { handleCliHelp } from '../lib/cli_help.mjs';
import { DEFAULT_SOURCE_PACK_DIR } from '../lib/default_pack_paths.mjs';

const DEFAULT_PACK_DIR = DEFAULT_SOURCE_PACK_DIR;
const LEXEME_MORPHOLOGY_OVERRIDES_FILE = 'lexeme_morphology_overrides.json';
const HELP_TEXT = `
Usage:
  pnpm node tools/reports/report_noun_form_gaps.mjs [options]

Options:
  --pack-dir <dir>         Canonical source pack directory. Default: packs/lexicon_source
  --json-out <file>        Optional JSON output path for the report payload
  --csv-out <file>         Optional CSV output path for row-level gap data
  --reference-lang <code>  Reference language used for comparison. Default: de
  -h, --help               Show this help message
`;

function parseArgs(argv) {
  handleCliHelp(argv, HELP_TEXT);
  const options = {
    packDir: DEFAULT_PACK_DIR,
    jsonOut: null,
    csvOut: null,
    referenceLang: 'de',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--pack-dir') options.packDir = argv[++i];
    else if (arg === '--json-out') options.jsonOut = argv[++i];
    else if (arg === '--csv-out') options.csvOut = argv[++i];
    else if (arg === '--reference-lang') options.referenceLang = argv[++i];
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeCsv(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const headers = [
    'lang',
    'concept_id',
    'lexeme_id',
    'countability',
    'reference_lang',
    'singular_surface',
    'reference_singular',
    'reference_plural',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(
      headers
        .map((header) => csvCell(row[header] ?? ''))
        .join(','),
    );
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function csvCell(value) {
  const raw = String(value ?? '');
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeOptional(value) {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

function loadLexemeMorphologyOverrides(packDir) {
  const filePath = path.join(packDir, LEXEME_MORPHOLOGY_OVERRIDES_FILE);
  if (!fs.existsSync(filePath)) {
    return new Map();
  }
  const raw = readJson(filePath);
  const source =
    raw?.lexeme_overrides && typeof raw.lexeme_overrides === 'object'
      ? raw.lexeme_overrides
      : {};
  const overrides = new Map();
  for (const [lexemeId, override] of Object.entries(source)) {
    if (!lexemeId || !override || typeof override !== 'object') {
      continue;
    }
    overrides.set(lexemeId, {
      pluralPolicy: normalizeOptional(override.plural_policy),
    });
  }
  return overrides;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packDir = path.resolve(options.packDir);
  const referenceLang = normalizeText(options.referenceLang).toLowerCase() || 'de';
  const manifest = readJson(path.join(packDir, 'manifest.json'));
  const content = readJson(path.join(packDir, 'content.json'));
  const lexemeMorphologyOverrides = loadLexemeMorphologyOverrides(packDir);

  const concepts = new Map(
    (content.concepts ?? []).map((concept) => [concept.concept_id, concept]),
  );
  const lexemes = (content.lexemes ?? []).filter(
    (lexeme) => lexeme.is_active !== false,
  );
  const forms = content.lexeme_forms ?? [];

  const activeNouns = lexemes.filter((lexeme) => {
    const concept = concepts.get(lexeme.concept_id);
    const pos =
      normalizeText(lexeme.pos).toLowerCase() ||
      normalizeText(concept?.pos).toLowerCase();
    return pos === 'noun';
  });

  const formsByLexeme = new Map();
  for (const form of forms) {
    const bucket = formsByLexeme.get(form.lexeme_id) ?? [];
    bucket.push(form);
    formsByLexeme.set(form.lexeme_id, bucket);
  }

  const primaryReferenceByConcept = new Map();
  for (const lexeme of activeNouns) {
    if (normalizeText(lexeme.lang).toLowerCase() !== referenceLang) {
      continue;
    }
    const lexemeForms = formsByLexeme.get(lexeme.lexeme_id) ?? [];
    const singular = lexemeForms.find(
      (form) =>
        form.number_value === 'sg' &&
        (form.grammatical_case === 'nom' || form.grammatical_case === 'none'),
    );
    const plural = lexemeForms.find(
      (form) =>
        form.number_value === 'pl' &&
        (form.grammatical_case === 'nom' || form.grammatical_case === 'none'),
    );
    primaryReferenceByConcept.set(lexeme.concept_id, {
      singular: singular?.surface ?? lexeme.text,
      plural: plural?.surface ?? null,
    });
  }

  const missingSourcePluralWithReferencePlural = [];
  const blockedSourcePluralWithReferencePlural = [];
  const summaryByLang = {};

  for (const lexeme of activeNouns) {
    const lang = normalizeText(lexeme.lang).toLowerCase();
    if (lang === referenceLang) {
      continue;
    }
    const lexemeForms = formsByLexeme.get(lexeme.lexeme_id) ?? [];
    const singular = lexemeForms.find((form) => form.number_value === 'sg');
    const plural = lexemeForms.find((form) => form.number_value === 'pl');
    const countability = normalizeText(lexeme.countability || 'none') || 'none';
    const pluralPolicy =
      normalizeText(lexemeMorphologyOverrides.get(lexeme.lexeme_id)?.pluralPolicy || 'none') ||
      'none';
    const reference = primaryReferenceByConcept.get(lexeme.concept_id) ?? {
      singular: '',
      plural: null,
    };

    const bucket = summaryByLang[lang] ?? {
      noun_lexemes: 0,
      with_sg_form: 0,
      with_pl_form: 0,
      marked_mass: 0,
      blocked_source_plural_with_reference_plural: 0,
      missing_source_plural_with_reference_plural: 0,
    };
    bucket.noun_lexemes += 1;
    if (singular) bucket.with_sg_form += 1;
    if (plural) bucket.with_pl_form += 1;
    if (countability === 'mass') bucket.marked_mass += 1;
    if (
      !plural &&
      reference.plural &&
      countability !== 'mass' &&
      pluralPolicy === 'blocked_asymmetric'
    ) {
      bucket.blocked_source_plural_with_reference_plural += 1;
      blockedSourcePluralWithReferencePlural.push({
        lang,
        concept_id: lexeme.concept_id,
        lexeme_id: lexeme.lexeme_id,
        countability,
        plural_policy: pluralPolicy,
        reference_lang: referenceLang,
        singular_surface: singular?.surface ?? lexeme.text,
        reference_singular: reference.singular,
        reference_plural: reference.plural,
      });
    }
    if (
      !plural &&
      reference.plural &&
      countability !== 'mass' &&
      pluralPolicy !== 'blocked_asymmetric'
    ) {
      bucket.missing_source_plural_with_reference_plural += 1;
      missingSourcePluralWithReferencePlural.push({
        lang,
        concept_id: lexeme.concept_id,
        lexeme_id: lexeme.lexeme_id,
        countability,
        plural_policy: pluralPolicy,
        reference_lang: referenceLang,
        singular_surface: singular?.surface ?? lexeme.text,
        reference_singular: reference.singular,
        reference_plural: reference.plural,
      });
    }
    summaryByLang[lang] = bucket;
  }

  const report = {
    pack_id: manifest.pack_id,
    version: manifest.version,
    schema_version: manifest.schema_version ?? 1,
    reference_language: referenceLang,
    summary_by_lang: summaryByLang,
    blocked_source_plural_with_reference_plural_count:
      blockedSourcePluralWithReferencePlural.length,
    blocked_source_plural_with_reference_plural_sample:
      blockedSourcePluralWithReferencePlural.slice(0, 30),
    missing_source_plural_with_reference_plural_count:
      missingSourcePluralWithReferencePlural.length,
    missing_source_plural_with_reference_plural_sample:
      missingSourcePluralWithReferencePlural.slice(0, 30),
  };

  if (options.jsonOut) {
    writeJson(path.resolve(options.jsonOut), report);
  }
  if (options.csvOut) {
    writeCsv(
      path.resolve(options.csvOut),
      missingSourcePluralWithReferencePlural,
    );
  }

  console.log(JSON.stringify(report, null, 2));
}

main();
