# Lexical Rules

This file is the canonical policy for lexical modeling decisions in the source
pack.

Use it when you need to decide whether something should be:

- a primary lexeme
- a secondary same-concept lexeme
- a form or morphology override
- a support-field synonym
- a separate concept
- a confusable/polysemy review case

Related docs:

- `docs/policies/EDITORIAL_RULES.md`
- `docs/guides/ENTRY_AUTHORING.md`
- `docs/guides/GENERATE_WORKFLOW.md`
- `docs/reference/CONTENT_CHANGELOG.md`

## Purpose

Lexicon should store precise lexical information, not formatting workarounds.

The source pack must answer these questions clearly:

- what is the canonical learner-facing form?
- what are real same-concept variants?
- what is only a formatting transformation?
- what is actually a different meaning?
- what is ambiguous enough to require review instead of automatic support?

If a row does not answer those questions cleanly, the data model is probably
wrong or incomplete.

## Canonical Principles

1. Source-pack data is the source of truth.
2. Runtime must not invent missing lexical distinctions.
3. Support fields are not a substitute for proper lexical modeling.
4. Formatting-only transformations are not lexical variants.
5. Polysemous or confusable forms must not be auto-promoted as support for one
   meaning without review.

## Decision Ladder

When evaluating a candidate alternate form, use this order:

1. Is it only the same form with grammar/formatting stripped?
   If yes, reject it as lexical support.

2. Is it a real same-concept everyday variant with the same intended answer?
   If yes, model it as lexical data, usually a secondary active `exact`
   lexeme or a form variant.

3. Is it only approximately similar, broader, narrower, or register-shifted?
   If yes, do not auto-accept it as support by default.

4. Is it clearly another meaning or a polysemous/confusable form?
   If yes, treat it as a separate concept or as a review-required collision.

## What Is Forbidden

These are not lexical alternates. They are formatting-only duplicates:

- `l'auto -> auto`
- `la casa -> casa`
- `the comparison -> comparison`
- `to eat -> eat`
- `to reach -> reach`

Do not store them as:

- `synonyms_json`
- `aliases`
- grading-only support hacks

If they need to be accepted in grading, the distinction must be modeled
structurally, not hidden in support text.

## Same-Concept Variants

A same-concept variant may be modeled as lexical data when all of these are
true:

- the meaning is still the same concept
- the variant is common enough to be learner-facing
- accepting it would not collapse another concept boundary
- it does not exist only because of stripped formatting

Typical good candidates:

- common everyday lexical alternates
- stable register-near forms
- very common same-concept support lexemes already used by learners

Typical non-candidates:

- broad thesaurus-style synonyms
- paraphrases
- phrase-level explanations
- more specific or more general nearby terms

## Support Fields

Support fields are conservative.

Use `synonyms_json` only for genuinely useful lexical support that remains
editorially safe and semantically aligned.

Do not use support fields for:

- article stripping
- infinitive-marker stripping
- filler paraphrases
- unresolved polysemous forms
- words that belong to another concept and only feel "close"

If in doubt, leave `synonyms_json` empty and raise the case for review.

## Nouns And Articles

For article-bearing noun languages, the learner-facing article belongs in the
editorial surface.

Current hard rule:

- Italian noun editorial surfaces keep the article

Examples:

- good: `la casa`, `l'ora`, `il medico`, `le case`
- bad: `casa`, `ora`, `medico`, `case`

The same rule applies to noun-form overrides:

- good: `pl_core = le case`
- bad: `pl_core = case`

## English Infinitives

English infinitives written with `to` must not create fake support rows by
stripping `to`.

Examples:

- bad: `to eat -> eat`
- bad: `to ask -> ask`
- bad: `to compare -> compare`

If the bare form is needed, it must be justified by the lexical model or by a
real accepted variant strategy, not by a synonym shortcut.

## Polysemy And Confusables

Some forms are dangerous because they can legitimately point to multiple
concepts.

Examples:

- `il capo`
  could mean `the boss`, `the head`, or other noun senses

- `the disease` vs `the illness`
  may be close, but not always interchangeable enough for automatic same-answer
  support

- `la giornata` vs `il giorno`
  related, but not the same lexical unit

Policy:

- do not auto-promote a polysemous form as answer support for one concept
- model separate meanings as separate concepts
- when useful, track them as confusable neighbors or collision-review cases

## Scoped Concepts Must Stay Scoped

Do not auto-support a scoped concept with an unscoped generic label.

Examples:

- `the male doctor` must not auto-accept `doctor`
- `the female doctor` must not auto-accept `doctor`

If the generic label is needed, model it as its own concept instead of
smearing it across gender-marked entries.

The same principle applies whenever the concept boundary is explicit in the
editorial label:

- gender-marked roles
- person/place/object sub-senses
- other reviewed concept splits where the learner should see the distinction

## Reviewed Time Pairs

Time words that look close should not be merged automatically.

Current reviewed policy:

- allow `il mattino` and `la mattina` as same-concept variants
- keep `il giorno` separate from `la giornata`
- keep `la notte` separate from `la nottata`
- keep `la sera` separate from `la serata` by default
- keep `l'anno` separate from `l'annata`

These pairs are related, but most of them shift the lexical unit toward an
experiential, eventive, or otherwise more specific reading.

## Cross-Language Scoping

When one language collapses meanings that another language keeps separate,
scope the label explicitly instead of accepting a broad generic shortcut.

Example:

- `to know` (scoped to familiarity with a person or place)
- `conoscere` (scoped to familiarity with a person or place)

Do not silently treat bare `know` as safe support if the course also needs a
separate branch for `sapere`.

If the broader form must remain acceptable, keep the scoped lexeme as the
primary and add the broader form only as a reviewed secondary lexeme.

Example:

- primary: `to know` (with note: familiarity sense, not factual knowledge)
- reviewed secondary support: bare `know`
- separate primary concept elsewhere: `to know` = `wissen` / `sapere`

## Level And Register Separation

Do not solve CEFR or register differences by collapsing everything into low-
level support.

Examples:

- `to need` is not the same A1 support as `to require`
- `aver bisogno` is not automatically the same A1 support as `necessitare`
  or `occorrere`
- `offer` is not automatically the same concept as `proposal`, `deal`, or
  `promozione`
- `beautiful` is not automatically the same concept as `pretty`, `nice`,
  `bellissimo`, or `carino`

If a word belongs better to a more formal, more specific, or higher-level
branch, keep it available for a separate concept instead of flattening it into
entry-level support.

## Sense Splits Inside The Same Domain

Do not merge neighboring senses just because they live in the same semantic
area.

Examples:

- body region vs organ:
  `the belly` / `la pancia` is not the same concept as `the stomach` /
  `lo stomaco`
- posture state vs posture change:
  `to sit` / `stare seduto` is not the same concept as `to sit down` /
  `sedersi`
- action family splits:
  `to make` is not automatically the same concept as `to do`

When in doubt, prefer an explicit split over a fuzzy support alias.

## Practical Classification Examples

### Reject as formatting-only duplicate

- `l'auto -> auto`
- `to eat -> eat`

### Allow as possible same-concept lexical variant

- `il medico -> il dottore`
- `il mattino -> la mattina`
- `to know` (familiarity sense) `-> to know` (bare)

Only if editorial review confirms that the course should accept both as the
same intended answer in that context.

### Review as polysemy/confusable case

- `la testa -> il capo`

Do not auto-accept this as support. Review whether the candidate belongs to a
different concept family.

### Reject as near-synonym but not exact enough

- `il giorno -> la giornata`
- `la sera -> la serata`
- `la notte -> la nottata`
- `l'anno -> l'annata`
- `offer -> proposal`
- `beautiful -> pretty`
- `pay attention -> take into account`

These are related, but should not be silently treated as the same answer.

## What To Do When Unsure

If a candidate form feels plausible but not obviously exact, ask:

1. Would I still accept this as the same answer without context?
2. Could this form be the primary label of another concept?
3. Am I adding lexical knowledge, or only a formatting convenience?
4. Am I collapsing a semantic distinction the learner should actually see?

If any answer is risky, do not auto-model it as support.

## Translation Equivalence: `meaning_status` Vocabulary

The `meaning_status` field on each lexeme expresses how accurately the
translation in that language represents the concept.

**This field has a direct pipeline consequence**: any lexeme with
`meaning_status` other than `"exact"` is excluded from grading support by
`report_answer_support_drift.mjs`. A `functional` or `approximate` translation
is surfaced for display and context, but not accepted as a correct learner
answer.

### Canonical values

| Value | When to use | Example |
|---|---|---|
| `exact` | 1:1 semantic equivalent - no meaningful loss, no ambiguity | `schon` = `già`, `blau` = `blue` = `blu` |
| `approximate` | Semantically close but with minor loss, scope restriction, or register shift; the best available translation but not perfect | `in general` / `in generale` for `überhaupt` general sense; `actually` / `in realtà` for `eigentlich` |
| `functional` | Same communicative function in context, but through a different word or structure; semantic overlap is indirect | `poi` for `überhaupt` in emphatic questions - Italian speakers use this word in that pragmatic slot, but the semantic content differs |
| `no_equivalent` | The target language has no standard lexical equivalent; the `text` field contains an editorial convention for display only, not a real translation | Modal particles like `halt` or `eben` if ever modeled |

### How to choose

- If a learner seeing this translation would reliably know the source word
  and nothing else: → `exact`
- If the translation is the best available but a learner could still be
  misled about nuance, register, or scope: → `approximate`
- If the translation word works in the pragmatic slot but has a different
  primary meaning in its own language: → `functional`
- If there is no real equivalent and the text is a display label only: →
  `no_equivalent`

### When to review existing `exact` entries

If a lexeme has `meaning_status: "exact"` but:
- the translation only works in one grammatical context (e.g. negative
  sentences only)
- the back-translation through the target language produces a different word
  than the source
- a native speaker of the target language would not recognize it as a
  primary meaning

...then it should be downgraded to `approximate` or `functional`.

## Tooling Consequences

The current toolchain enforces part of this policy:

- `upsert_pack_entries.mjs`
  rejects formatting-only support duplicates and articleless Italian noun text

- `quality_clean_pack.mjs`
  rejects the same invariant once data is in the source pack

- `generate_pack_forms.mjs`
  refuses to propagate broken noun/article data

This enforcement is intentionally narrower than the full lexical policy.
Formatting-only duplicates are blocked automatically.
Polysemy and semantic confusables still require editorial judgment.
