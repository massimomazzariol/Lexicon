import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleCliHelp } from '../lib/cli_help.mjs';
import { DEFAULT_SOURCE_PACK_DIR } from '../lib/default_pack_paths.mjs';

const HELP_TEXT = `
Usage:
  pnpm node tools/maintenance/fix_de_prose_umlauts.mjs [--apply]

Replaces transliterated German prose (ae/oe/ue/ss written for umlauts and
eszett) with the correct characters, using the word-level mapping in
tools/maintenance/de_prose_umlaut_fixes.json. Dry run by default: prints
every replacement and changes nothing without --apply.

Options:
  --pack-dir <dir>  Source pack directory. Default: packs/lexicon_source
  --apply           Write the fixes back to content.json
  -h, --help        Show this help message
`;

handleCliHelp(process.argv.slice(2), HELP_TEXT);

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const packDirIndex = args.indexOf('--pack-dir');
const packDir = packDirIndex >= 0 ? args[packDirIndex + 1] : DEFAULT_SOURCE_PACK_DIR;

const here = path.dirname(fileURLToPath(import.meta.url));
const { replacements } = JSON.parse(
  fs.readFileSync(path.join(here, 'de_prose_umlaut_fixes.json'), 'utf8'),
);

const pattern = new RegExp(
  `\\b(${Object.keys(replacements)
    .sort((a, b) => b.length - a.length)
    .join('|')})\\b`,
  'g',
);

const contentPath = path.join(packDir, 'content.json');
const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));

let total = 0;
const fixText = (value, where) => {
  if (typeof value !== 'string') return value;
  // Never rewrite slug-like ids (e.g. concept-b2-einschaetzen): a match that
  // touches a hyphen is part of an identifier, not prose.
  const fixed = value.replace(pattern, (word, _group, offset) => {
    const before = value[offset - 1];
    const after = value[offset + word.length];
    if (before === '-' || after === '-') return word;
    return replacements[word];
  });
  if (fixed === value) return value;
  total += 1;
  console.log(`${where}\n  - ${value}\n  + ${fixed}`);
  return fixed;
};

for (const def of content.concept_definitions ?? []) {
  const where = `definition ${def.concept_id} [${def.lang}]`;
  def.short_definition = fixText(def.short_definition, where);
  def.usage_note = fixText(def.usage_note, where);
  def.hint_text = fixText(def.hint_text, where);
  for (const key of ['synonyms_json', 'antonyms_json']) {
    if (Array.isArray(def[key])) def[key] = def[key].map((s) => fixText(s, `${where} ${key}`));
  }
  if (def.synonym_tiers_json && typeof def.synonym_tiers_json === 'object') {
    const retiered = {};
    for (const [answer, tier] of Object.entries(def.synonym_tiers_json)) {
      retiered[fixText(answer, `${where} synonym_tiers_json`)] = tier;
    }
    def.synonym_tiers_json = retiered;
  }
}
for (const example of content.examples ?? []) {
  example.sentence = fixText(example.sentence, `example ${example.example_id}`);
  example.translation_text = fixText(example.translation_text, `example ${example.example_id} translation`);
}
for (const concept of content.concepts ?? []) {
  concept.notes = fixText(concept.notes, `concept ${concept.concept_id} notes`);
}

console.log(`\n${total} field(s) ${apply ? 'fixed' : 'would be fixed (dry run; pass --apply)'}`);
if (apply && total > 0) {
  fs.writeFileSync(contentPath, JSON.stringify(content, null, 2), 'utf8');
}
