# Template Waves

These JSON files are editorial entry batches for the canonical source pack.

## Preferred structure

Use `wave` files for semantic families instead of one-file-per-term whenever
the concepts are clearly related.

Recommended naming patterns:

- `entries.a2_wave_comparison_and_distance.json`
- `entries.b1_wave_emotions_and_atmosphere.json`
- `entries.a2_b1_wave_spitze_semantic_tree.json`

## When to use a wave

Group concepts in the same file when they share at least one of these:

- the same semantic family
- likely confusable neighbors
- the same split or disambiguation decision
- the same editorial review pass

Examples:

- `Vergleich`, `vergleichen`, and `Entfernung` belong naturally to a comparison
  or distance wave
- `waschen`, `putzen`, `reinigen`, and `spuelen` belong to one cleaning-verbs
  wave
- the `Spitze / spitz` family belongs to one semantic-tree wave across levels

## When not to use a wave

Keep a separate file when the edit is clearly procedural rather than semantic,
for example:

- antonym-policy backfills
- alias-only fixes
- no-spoiler example patches
- narrow QA repair batches

Those files may stay as `batch_*`, `patch_*`, or similar names because they
describe editorial maintenance work rather than a lexical family.

Even in patch-style files, keep the canonical authoring rules:

- for article-bearing noun languages, learner-facing noun surfaces must keep
  the article
- do not create alias-only fixes that just strip the article from a noun
- if grading needs a real alternate answer, model it as lexical data rather
  than a fake synonym

## Migration note

Broad historical `curation_batch` files remain valid. For new concept work,
prefer wave-oriented naming unless there is a strong reason to keep a
procedural batch.
