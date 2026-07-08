# Changelog

All notable changes to this repository will be documented in this file.
Concept-level lexical-content history lives in
`docs/reference/CONTENT_CHANGELOG.md`.

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
