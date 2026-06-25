// Deterministic German verb decomposition - P1 of the verb plugin. No AI, no guessing.
//
// A prefix is accepted ONLY when the remainder is itself a known verb (validated against the
// lexicon's own German verb stems). That self-check avoids false splits: gehen ≠ ge+hen,
// geben ≠ ge+ben, antworten ≠ an+tworten ("tworten"/"hen"/"ben" are not verbs). The bias is
// conservative - if the base verb isn't in the lexicon yet, we say "simple" rather than invent
// a wrong split; it gets picked up once the base verb exists, or via an override.
//
// Variable-prefix verbs (durch/über/um/unter/hinter/wieder) are meaning-dependent and sometimes
// opposite (umfahren = run over vs drive around) → NEVER auto-decided: flagged needs_curation,
// resolved by an override. Strong/irregular forms and the haben/sein auxiliary are not derived
// here - they come from lexeme_morphology_overrides.json (curated), never from a model.

export const GERMAN_SEPARABLE_PREFIXES = [
  'zurück', 'zusammen', 'vorbei', 'heraus', 'herein', 'herunter', 'herauf', 'hervor',
  'hinaus', 'hinein', 'hinauf', 'hinunter', 'entgegen', 'weiter', 'empor', 'nieder',
  'voraus', 'voran', 'davon', 'weg', 'los', 'her', 'hin', 'fort', 'heim', 'teil',
  'fest', 'hoch', 'frei', 'mit', 'nach', 'vor', 'ab', 'an', 'auf', 'aus', 'bei', 'ein', 'zu'
];
export const GERMAN_INSEPARABLE_PREFIXES = ['miss', 'wider', 'emp', 'ent', 'ver', 'zer', 'be', 'ge', 'er'];
export const GERMAN_VARIABLE_PREFIXES = ['durch', 'über', 'unter', 'hinter', 'wieder', 'um'];

export const GERMAN_VERB_PLUGIN_SOURCE = 'language-plugin:de:verb-morphology';

const norm = (s) => String(s ?? '').trim().toLowerCase();
const stripReflexive = (w) => w.replace(/^sich\s+/, '').trim();
// infinitive shape: ends in -en / -eln / -ern / -n, long enough to carry a prefix + stem.
const isInfinitive = (w) => w.length >= 4 && /(?:e[lr]?n|n)$/.test(w);
const byLengthDesc = (arr) => [...arr].sort((a, b) => b.length - a.length);

const SEP = byLengthDesc(GERMAN_SEPARABLE_PREFIXES);
const INSEP = byLengthDesc(GERMAN_INSEPARABLE_PREFIXES);
const VAR = byLengthDesc(GERMAN_VARIABLE_PREFIXES);

/** Build the set of known German verb infinitives from content lexemes (for remainder validation). */
export function germanVerbStemSet(lexemes = []) {
  const set = new Set();
  for (const lx of lexemes) {
    if (norm(lx.lang) !== 'de' || norm(lx.pos) !== 'verb') continue;
    const w = stripReflexive(norm(lx.lemma || lx.text));
    if (w && !w.includes(' ')) set.add(w);
  }
  return set;
}

/**
 * Classify a German verb infinitive.
 * @returns {{verb_class:'separable'|'inseparable'|'variable'|'simple', prefix:string|null, stem:string|null, aux:'haben'|'sein', needs_curation?:boolean}|null}
 *   null when the input is not a single-word infinitive (caller should skip).
 */
export function analyzeGermanVerb(lemma, { knownStems = new Set(), override = null } = {}) {
  const w = stripReflexive(norm(lemma));
  if (!w || w.includes(' ') || !isInfinitive(w)) return null;

  const aux = override?.aux ?? 'haben';
  if (override?.verb_class) {
    return { verb_class: override.verb_class, prefix: override.prefix ?? null, stem: override.stem ?? null, aux };
  }

  const remainderIsKnownVerb = (rem) => rem.length >= 4 && isInfinitive(rem) && knownStems.has(rem);

  for (const p of SEP) {
    if (w.startsWith(p)) { const rem = w.slice(p.length); if (remainderIsKnownVerb(rem)) return { verb_class: 'separable', prefix: p, stem: rem, aux }; }
  }
  for (const p of INSEP) {
    if (w.startsWith(p)) { const rem = w.slice(p.length); if (remainderIsKnownVerb(rem)) return { verb_class: 'inseparable', prefix: p, stem: rem, aux }; }
  }
  for (const p of VAR) {
    if (w.startsWith(p)) { const rem = w.slice(p.length); if (remainderIsKnownVerb(rem)) return { verb_class: 'variable', prefix: p, stem: rem, aux, needs_curation: true }; }
  }
  return { verb_class: 'simple', prefix: null, stem: w, aux };
}

// ── P2: conjugation (deterministic; strong/irregular ONLY via curated overrides) ────────────
// Weak verbs conjugate by rule; strong verbs supply their forms through `override.forms`.
// For a separable verb the caller conjugates the BASE verb and passes its override (cascade),
// then this composes the discontinuous surfaces (steht auf / aufgestanden / aufzustehen).

const AUX_3SG = { haben: 'hat', sein: 'ist' };
export const GERMAN_VERB_CONJ_SLOTS = ['praes_2sg', 'praes_3sg', 'praet_3sg', 'partizip_ii', 'perfekt_3sg', 'zu_inf'];

// stem = infinitive minus -en (stehen→steh) or -n (sammeln→sammel, ändern→änder).
function weakStem(inf) { return inf.endsWith('en') ? inf.slice(0, -2) : inf.endsWith('n') ? inf.slice(0, -1) : inf; }
const endsSibilant = (stem) => /(?:s|ß|z|x|tz)$/.test(stem);
// Schwa-epenthesis: stems ending -d/-t, or consonant+m/n (atmen→atm, öffnen→öffn) but NOT
// after a liquid/nasal/vowel (lernen→lern takes no -e-).
const needsE = (stem) => /[dt]$/.test(stem) || /[^aeiouäöülrmnh][mn]$/.test(stem);

const weakPraes2sg = (s) => (endsSibilant(s) ? `${s}t` : needsE(s) ? `${s}est` : `${s}st`);
const weakPraes3sg = (s) => (needsE(s) ? `${s}et` : `${s}t`);
const weakPraet3sg = (s) => (needsE(s) ? `${s}ete` : `${s}te`);
const weakPII = (s, ge) => `${ge ? 'ge' : ''}${s}${needsE(s) ? 'et' : 't'}`;

/**
 * Conjugate a German verb into the learner slot set.
 * `override.forms` (when present) wins per slot - that's how strong verbs get correct forms;
 * for a separable verb pass the BASE verb's override so its strong forms cascade.
 * @returns {{verb_class, prefix, stem, aux, forms:Record<string,string>}|null}
 */
export function conjugateGermanVerb(lemma, { knownStems = new Set(), override = null } = {}) {
  const analysis = analyzeGermanVerb(lemma, { knownStems, override });
  if (!analysis) return null;
  const { verb_class, prefix, stem: baseInf, aux } = analysis;
  const whole = stripReflexive(norm(lemma));
  const base = verb_class === 'separable' ? baseInf : whole; // what actually conjugates
  const noGe = verb_class === 'inseparable' || base.endsWith('ieren');
  const s = weakStem(base);
  const ov = override?.forms ?? {};

  const base2sg = ov.praes_2sg ?? weakPraes2sg(s);
  const base3sg = ov.praes_3sg ?? weakPraes3sg(s);
  const basePraet = ov.praet_3sg ?? weakPraet3sg(s);
  const basePII = ov.partizip_ii ?? weakPII(s, !noGe);

  const forms = {};
  if (verb_class === 'separable') {
    forms.praes_2sg = `${base2sg} ${prefix}`;       // du stehst auf
    forms.praes_3sg = `${base3sg} ${prefix}`;       // er steht auf
    forms.praet_3sg = `${basePraet} ${prefix}`;     // er stand auf
    forms.partizip_ii = `${prefix}${basePII}`;      // aufgestanden
    forms.zu_inf = `${prefix}zu${base}`;            // aufzustehen
  } else {
    forms.praes_2sg = base2sg;
    forms.praes_3sg = base3sg;
    forms.praet_3sg = basePraet;
    forms.partizip_ii = basePII;
    forms.zu_inf = `zu ${whole}`;
  }
  forms.perfekt_3sg = `${AUX_3SG[aux] ?? 'hat'} ${forms.partizip_ii}`;
  return { verb_class, prefix, stem: baseInf, aux, forms };
}

// Build-plugin object the registry exposes via getVerbMorphologyPlugin('de').
export const germanVerbBuildPlugin = {
  languageCode: 'de',
  pluginSource: GERMAN_VERB_PLUGIN_SOURCE,
  buildStemSet: germanVerbStemSet,
  analyze: analyzeGermanVerb,
  conjugate: conjugateGermanVerb,
  conjSlots: GERMAN_VERB_CONJ_SLOTS,
};
