import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleCliHelp } from '../lib/cli_help.mjs';
import { withContentLock, writeJsonAtomic } from '../lib/content_store.mjs';
import { DEFAULT_SOURCE_PACK_DIR } from '../lib/default_pack_paths.mjs';
import { deterministicUuid } from '../lib/deterministic_id.mjs';

const HELP_TEXT = `
Usage:
  pnpm node tools/maintenance/apply_editorial_corrections.mjs [--apply]

Applies the editorial corrections in
tools/maintenance/editorial_corrections_a1_a2.json: replaces definitions and
usage notes, sense indicators and whole synonym lists (null clears a usage
note), removes examples by id and adds new example sentences.
Synonyms removed from a list are also pruned from synonym_tiers_json. Fails if
a referenced concept, definition row or example does not exist. Dry run by
default: prints every change and writes nothing without --apply.

Options:
  --pack-dir <dir>  Source pack directory. Default: packs/lexicon_source
  --corrections <file>  Corrections file. Default: the a1_a2 file above
                    (editorial_examples_de_a1_a2.json has the same format)
  --apply           Write the corrections back to content.json
  -h, --help        Show this help message
`;

handleCliHelp(process.argv.slice(2), HELP_TEXT);

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const packDirIndex = args.indexOf('--pack-dir');
const packDir = packDirIndex >= 0 ? args[packDirIndex + 1] : DEFAULT_SOURCE_PACK_DIR;

const here = path.dirname(fileURLToPath(import.meta.url));
const correctionsIndex = args.indexOf('--corrections');
const correctionsPath =
  correctionsIndex >= 0
    ? path.resolve(args[correctionsIndex + 1])
    : path.join(here, 'editorial_corrections_a1_a2.json');
const { corrections } = JSON.parse(fs.readFileSync(correctionsPath, 'utf8'));

const contentPath = path.join(packDir, 'content.json');

function correct(content) {
  const conceptIds = new Set(content.concepts.map((row) => row.concept_id));
  let changes = 0;
  const log = (line) => {
    changes += 1;
    console.log(line);
  };

  for (const [conceptId, byLang] of Object.entries(corrections)) {
    if (!conceptIds.has(conceptId)) throw new Error(`Unknown concept ${conceptId}.`);
    for (const [lang, fix] of Object.entries(byLang)) {
      const tag = `${conceptId} [${lang}]`;
      const needsDefinitionRow = ['definition', 'usage_note', 'sense_indicator', 'synonyms', 'synonym_tiers'].some(
        (field) => fix[field] !== undefined,
      );
      const def = content.concept_definitions.find(
        (row) => row.concept_id === conceptId && row.lang === lang,
      );
      if (needsDefinitionRow && !def) throw new Error(`${tag}: no definition row.`);

      for (const [field, column] of [
        ['definition', 'short_definition'],
        ['usage_note', 'usage_note'],
        ['sense_indicator', 'sense_indicator'],
      ]) {
        if (fix[field] === undefined || def[column] === fix[field]) continue;
        log(`${tag} ${column} - ${def[column]}\n${tag} ${column} + ${fix[field]}`);
        def[column] = fix[field];
      }

      if (fix.synonyms !== undefined) {
        const before = JSON.stringify(def.synonyms_json ?? []);
        def.synonyms_json = [...fix.synonyms];
        const after = JSON.stringify(def.synonyms_json);
        if (before !== after) log(`${tag} SYN - ${before}\n${tag} SYN + ${after}`);
      }

      if (fix.synonym_tiers !== undefined) {
        // Reviewed tiers (CONTRACT.md): only exact / loose are stored, close is the default.
        const before = JSON.stringify(def.synonym_tiers_json ?? null);
        def.synonym_tiers_json = { ...fix.synonym_tiers };
        const after = JSON.stringify(def.synonym_tiers_json);
        if (before !== after) log(`${tag} TIERS - ${before}\n${tag} TIERS + ${after}`);
      }

      if (fix.synonyms !== undefined || fix.synonym_tiers !== undefined) {
        // synonym_tiers_json keys must reference surviving synonyms only
        if (def.synonym_tiers_json && typeof def.synonym_tiers_json === 'object') {
          for (const key of Object.keys(def.synonym_tiers_json)) {
            if (!def.synonyms_json.includes(key)) delete def.synonym_tiers_json[key];
          }
        }
      }

      for (const exampleId of fix.remove_examples ?? []) {
        const index = content.examples.findIndex(
          (row) => row.example_id === exampleId && row.concept_id === conceptId && row.lang === lang,
        );
        if (index < 0) {
          // Re-runs are expected: an id that is gone everywhere was removed by a previous run.
          if (content.examples.some((row) => row.example_id === exampleId)) {
            throw new Error(`${tag}: example ${exampleId} belongs to another concept or language.`);
          }
          console.log(`${tag} EX already removed: ${exampleId}`);
          continue;
        }
        log(`${tag} EX - ${content.examples[index].sentence}`);
        content.examples.splice(index, 1);
      }

      for (const sentence of fix.add_examples ?? []) {
        // Same id seed as upsert_pack_entries.mjs, so a later upsert of this sentence is a no-op.
        const exampleId = deterministicUuid(`example:${conceptId}:${lang}:${sentence.toLowerCase()}`);
        if (content.examples.some((row) => row.example_id === exampleId)) continue;
        content.examples.push({
          example_id: exampleId,
          concept_id: conceptId,
          lang,
          sentence,
          translation_lang: null,
          translation_text: null,
        });
        log(`${tag} EX + ${sentence}`);
      }
    }
  }
  return changes;
}

if (apply) {
  withContentLock(contentPath, () => {
    const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
    const changes = correct(content);
    writeJsonAtomic(contentPath, content);
    console.log(`\n${changes} change(s) written.`);
  }, { tool: 'apply_editorial_corrections' });
} else {
  const changes = correct(JSON.parse(fs.readFileSync(contentPath, 'utf8')));
  console.log(`\n${changes} change(s) (dry run; pass --apply).`);
}
