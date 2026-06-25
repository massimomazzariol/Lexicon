# Generate Workflow

This guide defines what `genera` means in the Lexicon editorial workflow.

Use it when a contributor or assistant receives a request like:

- `genera Vergleich`
- `genera empfindlich`
- `genera "distance" from English`
- `genera questa parola e le relative parole`

The goal is to make `genera` useful, consistent, and bounded. It should create
or complete the right lexical content around a word, not dump an uncontrolled
semantic field.

## Working Principle

`genera` is concept-first, not string-first.

That means the workflow must:

1. normalize the requested input to the right lemma when needed
2. verify whether the concept already exists
3. decide whether the request belongs to one concept or to multiple separate
   concepts
4. enrich the correct concept(s) with the right languages, examples, accepted
   answers, and tightly related lexical items

It must not collapse different meanings into a single convenient answer.

## Accepted Inputs

The workflow should accept:

- a lemma in German, English, or Italian
- a surface form that needs normalization
  Example: `erreicht` -> `erreichen`
- a translation-side request
  Example: `distance` when the German lemma is not yet known
- an ambiguous term
  Example: `ora`

If the input is ambiguous, `genera` must explicitly split the meanings instead
of hiding the ambiguity.

## Mandatory Checks

For every `genera` request, do all of the following:

1. find whether the lemma or concept already exists in the packs
2. check nearby concepts across levels, not only in one CEFR band
3. verify whether apparent equivalents should stay in one concept or split into
   two or more concepts
4. verify whether synonyms or antonyms are truly clean, or should be omitted
5. verify that examples do not spoil the target word
6. verify the CEFR level pragmatically and record when the placement is
   editorial rather than inherited from existing data

## Preflight Discovery

Before editing content for a new `genera` request, run the concept-discovery
report:

```bash
pnpm node tools/reports/report_concept_discovery.mjs \
  --pack-dir packs/lexicon_source \
  --term spitze \
  --lang de
```

This preflight should tell you, before any pack edits:

- whether the term already exists as a lexeme
- whether it only appears as a form or support-field hit
- whether nearby concepts suggest `same concept` or `split`
- whether the existing concept is already complete or still partial

The discovery report is a decision-support tool, not an automatic editorial
decision. It should reduce repeated manual audits, not replace semantic review.

## Concept Coverage Follow-up

If discovery points to an existing concept, run the concept coverage matrix
before editing it:

```bash
pnpm node tools/reports/report_concept_coverage_matrix.mjs \
  --pack-dir packs/lexicon_source \
  --concept-id concept-a2-spitze-tip
```

This report should tell you:

- whether the concept is already complete across DE / EN / IT
- whether definitions or examples are still missing in one language
- whether noun concepts are missing core forms
- whether support fields are intentionally empty or simply absent

## Collision Review

If the word is ambiguous or looks dangerously close to an existing family, run
the collision detector before creating or merging concepts:

```bash
pnpm node tools/reports/report_concept_collisions.mjs \
  --pack-dir packs/lexicon_source \
  --lang de \
  --term spitze
```

This report should tell you:

- whether one exact term already maps to multiple concepts
- whether the ambiguity looks like healthy polysemy or a dirty duplicate risk
- which concept pairs deserve `split` review
- which concept pairs may deserve `merge` review instead

## Canonical Generate Command

Once the preflight checks are in place, run the single-command workflow:

```bash
pnpm node tools/reports/run_generate_workflow.mjs \
  --pack-dir packs/lexicon_source \
  --term spitze \
  --lang de
```

This command is the canonical operational entrypoint for `genera`. It wraps
the current preflight stack and returns the standard editorial brief in one
step.

Use `--out-file` when you want to persist the brief as a Markdown artifact:

```bash
pnpm node tools/reports/run_generate_workflow.mjs \
  --pack-dir packs/lexicon_source \
  --term spitze \
  --lang de \
  --out-file docs/data/generate_spitze.md
```

## Generate Brief

If you only need the raw structured brief without the workflow wrapper, you can
still run the lower-level report directly:

```bash
pnpm node tools/reports/report_generate_brief.mjs \
  --pack-dir packs/lexicon_source \
  --term spitze \
  --lang de
```

This brief should unify:

- discovery recommendation
- core concept candidates
- accepted answers and forms
- same-concept equivalents
- confusable neighbors
- example samples
- synonym / antonym state

The brief is the standard response shape for `genera`. The wrapper command does
not write pack data either, but it should make the next editorial decision
obvious and reusable.

## Required Output Blocks

Every successful `genera` pass should produce these blocks, even if some are
intentionally empty.

### 1. Core Concept

The main concept to create or update:

- concept id or proposed concept id
- lemma per language
- precise meaning
- CEFR level
- concept-vs-split decision

### 2. Accepted Answers And Forms

What should be accepted on the correct concept:

- primary lemma
- allowed variants
- article-bearing or article-less forms when editorially justified
- inflectional forms when relevant

These must be attached to the correct concept, not added globally.

### 3. Related Words

`Relative parole` are required, but they must be tightly bounded.

Use only these buckets:

- `same-concept equivalents`
  Cross-language lexicalizations of the same concept.
- `nearby family`
  One to four closely related words that a learner is likely to need next.
- `confusable neighbors`
  Similar-looking or adjacent words that must stay separate.

Do not generate a large semantic cloud.

### 4. Examples

Add examples that:

- are natural
- are no-spoiler
- show the intended sense
- distinguish the concept from nearby confusable meanings when helpful

### 5. Synonyms / Antonyms

Add them only when they are genuinely clean.

If a concept does not have a robust synonym or antonym:

- leave it empty, or
- mark the corresponding policy intentionally

Do not force filler content.

## Rules For Related Words

This is the most important guardrail for `genera`.

When the user asks for `parole relative`, generate only items that pass at
least one of these tests:

- they are alternate lexicalizations of the same concept in another language
- they are the nearest concept in the same pedagogical family
- they are a likely confusion risk worth keeping separate

Good examples:

- `Vergleich`
  Nearby family: `vergleichen`, `ähnlich`, `unterschiedlich`
- `waschen`
  Confusable neighbors: `putzen`, `reinigen`, `spülen`
- `ora`
  Confusable neighbors: `adesso`, `Stunde`, `Uhr`, `Uhrzeit`

Bad examples:

- adding the whole travel domain because the word happens to occur there
- adding broad theme words instead of lexical neighbors
- adding weak paraphrases as synonyms just to fill fields

The current automation now applies these guardrails:

- `same-concept equivalents` are always safe to include
- `nearby family` is capped at `4` items
- `nearby family` is auto-suggested only from strong signals:
  - shared non-confusable clusters
  - or discovery neighbors with shared domain tags and near CEFR level
- anything that looks like overload or split/merge risk stays in
  `confusable neighbors`, not in `nearby family`
- if no strong signal exists, `nearby family` stays on
  `manual_review_required`

## Split Decision

When `genera` encounters multiple meanings, the workflow must say which of
these happened:

- `same concept with multiple lemmas`
- `separate concepts to avoid ambiguity`

Examples:

- `distance` -> one concept can accept both `Entfernung` and `Distanz`
  when the intended scope is still the same core meaning
- `ora` -> separate concepts, because `now`, `hour`, `clock`, and `time of day`
  are not the same meaning
- `pulire` -> separate concepts for `waschen`, `putzen`, `reinigen`, `spülen`

## Minimal Generate Contract

When `genera` finishes, the result should answer these questions:

- what concept did we touch?
- what exact meaning did we choose?
- what did we accept in DE / EN / IT?
- what related words did we intentionally include?
- what nearby words did we intentionally keep separate?
- what CEFR level did we assign or confirm?
- what examples and support fields were added?

## Example Shape

For a request like `genera Vergleich`, the expected shape is:

- core concept: `Vergleich / il confronto / the comparison`
- nearby family: `vergleichen`, `ähnlich`, `unterschiedlich`
- split decision: keep `Vergleich` separate from the verb `vergleichen`
- examples: no-spoiler noun examples
- synonyms/antonyms: only if robust

For a request like `genera pulire`, the expected shape is:

- split into multiple concepts
- `waschen = lavare`
- `putzen = pulire`
- `reinigen = pulire` in a more technical/formal sense
- `spülen = sciacquare`

## Follow-up Automation

This guide defines the editorial contract first.

The first tooling wave is now in place: discovery, coverage, collision review,
the unified brief, related-word guardrails, and the canonical one-command
workflow already exist. Future automation can extend this stack, but it must
still respect these rules:

- no global variants
- no meaning collapse
- no spoiler examples
- no uncontrolled related-word expansion
