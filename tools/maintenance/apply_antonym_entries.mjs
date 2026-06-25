import fs from 'node:fs';
import path from 'node:path';

import { handleCliHelp } from '../lib/cli_help.mjs';
import { DEFAULT_SOURCE_PACK_DIR } from '../lib/default_pack_paths.mjs';

const HELP_TEXT = `
Usage:
  pnpm node tools/maintenance/apply_antonym_entries.mjs --entries <path-to-entries.json> [options]

Options:
  --pack-dir <dir>         Canonical source pack directory. Default: packs/lexicon_source
  --entries <file>         Curated antonym-policy entries JSON to merge into source content
  -h, --help               Show this help message
`;

function parseArgs(argv) {
  handleCliHelp(argv, HELP_TEXT);
  const options = {
    packDir: DEFAULT_SOURCE_PACK_DIR,
    entriesPath: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--pack-dir') options.packDir = argv[++i];
    else if (arg === '--entries') options.entriesPath = argv[++i];
  }

  if (!options.entriesPath) {
    throw new Error('Missing --entries <path-to-entries.json>.');
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeOptional(value) {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

function parseStringList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeOptional(entry)).filter(Boolean);
  }
  const one = normalizeOptional(value);
  return one ? [one] : [];
}

function mergeUniqueStrings(primary = [], secondary = []) {
  const output = [];
  const seen = new Set();
  for (const value of [...primary, ...secondary]) {
    const normalized = normalizeOptional(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packDir = path.resolve(options.packDir);
  const entriesPath = path.resolve(options.entriesPath);
  const contentPath = path.join(packDir, 'content.json');

  const content = readJson(contentPath);
  const entries = readJson(entriesPath);
  const conceptDefinitions = Array.isArray(content.concept_definitions)
    ? content.concept_definitions
    : [];

  let updated = 0;

  for (const entry of entries) {
    const conceptId = normalizeOptional(entry?.concept_id);
    if (!conceptId || !entry?.translations || typeof entry.translations !== 'object') {
      continue;
    }

    for (const [langRaw, translation] of Object.entries(entry.translations)) {
      const lang = normalizeText(langRaw).toLowerCase();
      const antonyms = parseStringList(
        translation?.card_antonyms ?? translation?.cardAntonyms,
      );
      const policy =
        translation?.antonym_policy && typeof translation.antonym_policy === 'object'
          ? { ...translation.antonym_policy }
          : translation?.antonymPolicy &&
            typeof translation.antonymPolicy === 'object'
          ? { ...translation.antonymPolicy }
          : null;

      if (antonyms.length === 0 && !policy) continue;

      const definition = conceptDefinitions.find(
        (row) => row.concept_id === conceptId && String(row.lang).toLowerCase() === lang,
      );
      if (!definition) {
        throw new Error(`Missing concept_definition for ${conceptId} ${lang}`);
      }

      const nextAntonyms = mergeUniqueStrings(
        Array.isArray(definition.antonyms_json) ? definition.antonyms_json : [],
        antonyms,
      );

      definition.antonyms_json = nextAntonyms;
      if (policy) {
        definition.antonym_policy_json = policy;
      }
      updated += 1;
    }
  }

  writeJson(contentPath, content);
  console.log(JSON.stringify({ ok: true, updated }, null, 2));
}

main();
