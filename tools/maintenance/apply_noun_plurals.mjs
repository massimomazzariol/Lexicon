// MORPH-01: apply the hand-curated German noun plural completions
// (noun_plural_completions.json) to the source pack. Sets `plural` on the
// lexeme (bare form, the noun plugin adds articles per slot) or marks the
// genuine mass nouns `countability: "mass"` so the gap report treats the
// absence as intentional. Idempotent; never overwrites an existing value.
//
//   node tools/maintenance/apply_noun_plurals.mjs           # preview
//   node tools/maintenance/apply_noun_plurals.mjs --apply   # write
//
// After --apply run the pipeline to mint the plural forms:
//   npm run pipeline

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeJsonAtomic, withContentLock } from '../lib/content_store.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CONTENT = resolve(process.cwd(), 'packs/lexicon_source/content.json');
const DATA = resolve(here, 'noun_plural_completions.json');
const apply = process.argv.includes('--apply');

const { plurals, mass, genders = {}, overrides_pl: overridesPl = {} } = JSON.parse(readFileSync(DATA, 'utf8'));
const OVERRIDES = resolve(process.cwd(), 'packs/lexicon_source/lexeme_morphology_overrides.json');
const overridesFile = JSON.parse(readFileSync(OVERRIDES, 'utf8'));
const data = JSON.parse(readFileSync(CONTENT, 'utf8'));
const byId = new Map(data.lexemes.map((lx) => [lx.lexeme_id, lx]));
// The pipeline consumes lexeme.plural after minting the forms
// (stripAuthoringLexemeFields in generate_pack_forms.mjs), so idempotency is
// judged on the generated plural FORM, not on the field.
const hasPluralForm = new Set(
  (data.lexeme_forms ?? [])
    .filter((f) => f.number_value === 'pl' || f.number_value === 'plural')
    .map((f) => f.lexeme_id),
);

let setPlural = 0;
let setMass = 0;
let skipped = 0;
const missing = [];

let setGender = 0;
for (const [lexemeId, gender] of Object.entries(genders)) {
  const lx = byId.get(lexemeId);
  if (!lx) {
    missing.push(lexemeId);
    continue;
  }
  if (!lx.gender || lx.gender === 'none') {
    lx.gender = gender;
    setGender += 1;
  }
}

for (const [lexemeId, plural] of Object.entries(plurals)) {
  const lx = byId.get(lexemeId);
  if (!lx) {
    missing.push(lexemeId);
    continue;
  }
  if (lx.plural || hasPluralForm.has(lexemeId)) {
    skipped += 1;
    continue;
  }
  lx.plural = plural;
  if (!lx.countability || lx.countability === 'none') lx.countability = 'count';
  setPlural += 1;
}

for (const lexemeId of mass) {
  const lx = byId.get(lexemeId);
  if (!lx) {
    missing.push(lexemeId);
    continue;
  }
  if (lx.countability === 'mass') {
    skipped += 1;
    continue;
  }
  lx.countability = 'mass';
  setMass += 1;
}

// it/en plurals live in lexeme_morphology_overrides.json as pl_core (the
// same mechanism casa/mela already use); never overwrite an existing entry.
let setOverride = 0;
for (const [lexemeId, plural] of Object.entries(overridesPl)) {
  if (!byId.has(lexemeId)) {
    missing.push(lexemeId);
    continue;
  }
  const existing = overridesFile.lexeme_overrides[lexemeId];
  if (existing?.forms?.pl_core || hasPluralForm.has(lexemeId)) {
    skipped += 1;
    continue;
  }
  overridesFile.lexeme_overrides[lexemeId] = {
    countability: 'count',
    forms: { pl_core: plural },
    notes: 'approved plural',
  };
  setOverride += 1;
}

console.log(`plurals to set: ${setPlural} · overrides to set: ${setOverride} · mass to mark: ${setMass} · genders to set: ${setGender} · already done: ${skipped}`);
if (missing.length) {
  console.error(`MISSING lexeme ids (fix the data file): ${missing.join(', ')}`);
  process.exit(1);
}

if (!apply) {
  console.log('Preview only. Re-run with --apply, then `npm run pipeline` to mint the forms.');
  process.exit(0);
}

withContentLock(CONTENT, () => {
  writeJsonAtomic(CONTENT, data);
  writeJsonAtomic(OVERRIDES, overridesFile);
}, { tool: 'apply_noun_plurals' });
console.log('Written. Next: npm run pipeline (generates the plural forms), then rebuild.');
