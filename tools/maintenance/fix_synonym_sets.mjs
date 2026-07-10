import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleCliHelp } from '../lib/cli_help.mjs';
import { DEFAULT_SOURCE_PACK_DIR } from '../lib/default_pack_paths.mjs';

const HELP_TEXT = `
Usage:
  pnpm node tools/maintenance/fix_synonym_sets.mjs [--apply]

Applies the editorial synonym/antonym corrections from
tools/maintenance/synonym_set_corrections.json (whole-list replacement per
concept/lang) and deduplicates every remaining synonym/antonym list case- and
article-insensitively. Entries removed from synonyms_json are also pruned from
synonym_tiers_json. Dry run by default: prints every change and writes nothing
without --apply.

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
const { corrections } = JSON.parse(
  fs.readFileSync(path.join(here, 'synonym_set_corrections.json'), 'utf8'),
);

const ARTICLES = /^(der|die|das|den|dem|des|ein|eine|the|a|an|il|lo|la|le|i|gli|un|una|uno|l')\s+/i;
const dedupeKey = (s) => s.trim().replace(ARTICLES, '').replace(/^l'/i, '').toLowerCase();

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = dedupeKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

const contentPath = path.join(packDir, 'content.json');
const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));

let corrected = 0;
let deduped = 0;
let tiersPruned = 0;

for (const def of content.concept_definitions ?? []) {
  const fix = corrections[def.concept_id]?.[def.lang];
  const before = {
    syn: JSON.stringify(def.synonyms_json ?? []),
    ant: JSON.stringify(def.antonyms_json ?? []),
  };

  if (fix?.synonyms !== undefined) def.synonyms_json = [...fix.synonyms];
  if (fix?.antonyms !== undefined) def.antonyms_json = [...fix.antonyms];

  if (Array.isArray(def.synonyms_json)) def.synonyms_json = dedupe(def.synonyms_json);
  if (Array.isArray(def.antonyms_json)) def.antonyms_json = dedupe(def.antonyms_json);

  const after = {
    syn: JSON.stringify(def.synonyms_json ?? []),
    ant: JSON.stringify(def.antonyms_json ?? []),
  };
  if (before.syn !== after.syn || before.ant !== after.ant) {
    if (fix) corrected += 1; else deduped += 1;
    console.log(`${def.concept_id} [${def.lang}]`);
    if (before.syn !== after.syn) console.log(`  SYN - ${before.syn}\n  SYN + ${after.syn}`);
    if (before.ant !== after.ant) console.log(`  ANT - ${before.ant}\n  ANT + ${after.ant}`);
  }

  // synonym_tiers_json keys must reference surviving synonyms only
  if (def.synonym_tiers_json && typeof def.synonym_tiers_json === 'object') {
    const surviving = new Set((def.synonyms_json ?? []).map(dedupeKey));
    for (const key of Object.keys(def.synonym_tiers_json)) {
      if (!surviving.has(dedupeKey(key))) {
        delete def.synonym_tiers_json[key];
        tiersPruned += 1;
      }
    }
  }
}

console.log(
  `\n${corrected} definition(s) corrected, ${deduped} deduplicated only, ` +
  `${tiersPruned} stale tier entrie(s) pruned ` +
  `${apply ? '(written)' : '(dry run; pass --apply)'}`,
);
if (apply) {
  fs.writeFileSync(contentPath, JSON.stringify(content, null, 2) + '\n', 'utf8');
}
