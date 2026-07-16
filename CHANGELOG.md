# Changelog

All notable changes to this repository will be documented in this file.
Concept-level lexical-content history lives in
`docs/reference/CONTENT_CHANGELOG.md`.

## [Unreleased]

- Content: flat synonym and antonym strings become a real concept graph:
  concept_relations edges (synonym/antonym/related) with level adjacency,
  a mutual-only automatic writer, and a human review queue for everything
  ambiguous. CONTRACT.md documents the new optional field; consumers that
  ignore it keep working.
- Content: noun plural coverage completed across A1 to C2 (German plurals
  on the lexeme, Italian and English via morphology overrides, genuine
  mass nouns marked as uncountable).
- Tooling: retired three completed one-shot maintenance scripts
  (fix_de_prose_umlauts, fix_synonym_sets, apply_antonym_entries); their
  curated data files stay as provenance and git history keeps the scripts.
  The live maintenance tools are documented in docs/reference/TOOLS.md.
- Tooling: content commits from the console and autopilot stay local by
  default; pushing needs the explicit --push flag or the Publish confirm.
- Docs: the content license note moved to docs/CONTENT_LICENSE.md so GitHub
  license detection reports Apache-2.0 cleanly; .gitignore is no longer
  tracked.

## [0.2.2] - 2026-07-14

- Content: the German "einfach" polysemy split into three concepts (the
  adverb just/simply, the one-way ticket, plain/modest). Closes BUG-ED-04.

## [0.2.1] - 2026-07-10

- Content: editorial pass over the synonym and antonym sets (184 sets
  repaired across all levels).
- Demo: the content explorer redesigned with a dictionary-style look.
## [0.2.0] - 2026-07-08

Full CEFR coverage and a public content explorer.

- Content: C1 and C2 vocabulary seeded (45 and 48 concepts per level);
  expressions extended to 10+ per level on every band A1 to C2; the 33
  translation-prompt collisions disambiguated; transliterated umlauts in
  German prose fixed (103 fields); every source concept now carries a
  review_status.
- Build: 12 new runtime packs (de/en/it x C1/C2 x vocab/expressions), 36
  packs total; pack manifests now declare CC-BY-4.0 instead of the stale
  "internal" marker, and the builder requires an explicit content license.
- Tooling: upsert_pack_entries no longer drops review_status on concept
  updates (regression-tested).
- Demo: a dependency-free content explorer deployed to GitHub Pages reads
  the published distribution directly.
- Docs: ADR numbering gap closed (0004 renumbered to 0002); CONTRACT.md
  documents the optional, possibly unresolvable image_url metadata field.

## [0.1.0] - 2026-06-26

Initial public release of the standalone Lexicon platform: curated lexical
content built into versioned runtime packs and published as the file-based JSON
distribution (see `CONTRACT.md`). Consumers integrate only through that
distribution; this repository does not depend on or reach into any consumer.
