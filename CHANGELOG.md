# Changelog

All notable changes to this repository will be documented in this file.
Concept-level lexical-content history lives in
`docs/reference/CONTENT_CHANGELOG.md`.

## [0.6.2] - 2026-11-12

- Content: specific sense labels for every DL-015 adjective/adverb pair
  (93 concepts), replacing the generic pattern; the definitions of
  `wahrscheinlich` (de, it) and of the `praktisch` adverb (it) rewritten as
  sentences. See CONTENT_CHANGELOG.md.
- Tools: `doctor` counts a shared prompt whose concepts carry distinct sense
  indicators as resolved. The 19 prompts it listed were all already told apart
  by their labels; it now lists only groups without distinct labels.

## [0.6.1] - 2026-11-10

- Fix: 0.6.0 shipped without the 11 A1/A2 adverb concepts (DL-015). They were
  created `needs_review` and without forms, so the build left them out, while
  `velocemente`, `quickly`, `lentamente` and `slowly` had already moved off the
  adjective concepts: in 0.6.0, `schnell` and `langsam` no longer accept them.
  The concepts now have their forms, passed the review gate and ship.
- Content: DL-015 covers every level. 40 B1-C2 adjectives get their adverb
  use as a separate concept (regelmäßig: regolarmente, offensichtlich:
  evidentemente, ...); `durchschnittlich` joins the chunk `im Durchschnitt`;
  `nachweislich` is an adverb concept. See CONTENT_CHANGELOG.md.
- Content: 24 empty duplicate lexemes removed (the same text twice in one
  concept, since the first commit), and the nouns removed from the adjective
  `ambivalent`.
- Tools: `finalize_source.mjs` runs after every write (pipeline with
  `--entries`, populate, the autopilot, the console): repairs integrity, mints
  missing forms, runs the review gate, and fails when a required concept would
  not ship. Tested end to end, including the AI chain against a fake local LLM.
- Tools: the same word twice in one concept is an invariant violation;
  `rebuild` leaves unchanged packs untouched; `apply_editorial_corrections` can
  set a concept's pos and remove lexemes.

## [0.6.0] - 2026-11-10

- Content: every concept now has an English example (351 added, 210 at
  A1/A2 and 141 at B1 to C2), checked against the no-spoiler rule. Every
  concept has an example in every language.
- Content: the adverb use of 11 A1/A2 German adjectives is its own concept
  where Italian and English use another word (gut: bene, well; schlecht:
  male, badly; schnell: velocemente, quickly; ...). `velocemente`,
  `quickly`, `lentamente` and `slowly` move off the adjective concepts. New
  rule DL-015; every concept that now shares a word carries sense
  indicators. See CONTENT_CHANGELOG.md.

## [0.5.0] - 2026-10-19

- Content: A1/A2 review pass. 25 everyday equivalents become exact answers
  (for example `la camera`, `la macchina`, `spedire`, `meistens`,
  `der Fahrstuhl`), mixed senses narrowed (`Land`, `Platz`, `Lauf`, `malen`),
  false synonyms removed (`Kaninchen` for `Hase`, `kernig` for `wichtig`),
  weak definitions and examples rewritten. Land and Platz split into two
  concepts each. Every concept at every level has a German and an Italian
  example. Every synonym reviewed (155 removed, 146 tiered exact) and every
  definition, usage note and sense indicator reviewed (622 fixes). See
  CONTENT_CHANGELOG.md.
- Validation: `quality_clean_pack` now enforces the DL-014 sense indicator
  rules (they were only unit-tested), so a shared word without labels stops
  the pipeline.
- Fix: `generate_pack_forms` and `upsert_pack_entries` rebuilt definition rows
  from a fixed field list, which dropped every `sense_indicator` and
  `synonym_tiers_json`. Both now keep the fields they do not touch; tests cover it.
- Fix: `curate_pack_metadata` replaced every cluster with the German plugin's
  seven (wiping 219 interconnect synonym clusters) and cleared every
  `level_override` outside the plugin's word table. Plugins now update only
  the clusters and overrides they own, in place; a regression test covers it.
  `pnpm run pipeline` is safe to run on the current source again.
- Fix: `generate_pack_forms` made the first lexeme in file order the primary
  one and ignored the authored `is_primary`, so a template could never change
  a primary. The authored flag now wins; file order decides only when no
  lexeme is marked.
- Validation: learner-facing text (definitions, usage notes, hints, sense
  indicators, examples) must not contain repository ids; three usage notes
  showed "siehe Konzept ec6fe4e3" to learners.
- Fix: `rebuild_runtime_packs` ignores line endings when it decides whether a
  pack changed, so a Windows checkout (CRLF) no longer bumps every version.
- Tooling: one shared `deterministicUuid` (tools/lib/deterministic_id.mjs)
  replaces three copies.
- Tooling: `tools/maintenance/apply_editorial_corrections.mjs` applies the
  reviewed definition, synonym, usage note, sense indicator and example
  corrections from a JSON file (`--corrections` picks the file).

## [0.4.0] - 2026-10-18

- Content: words are bare text only (DL-013). Parenthetical qualifiers such
  as `to know (a person/place)` left the word fields; the scope now lives in
  `usage_note`, so a consumer can grade the plain word.
- Content: the 50 concepts that share a word with another concept carry a
  short `sense_indicator` in de, en and it (DL-014, 150 labels).
  CONTRACT.md documents the new optional field; consumers that ignore it
  keep working.
- CI and docs: the staging branch runs CI, and RELEASING documents the
  stable and prerelease channels.
- Tooling: `pnpm test` runs every tooling test, the same set CI runs.
- Docs: a shorter README with a quick start for authors.
- Docs: consumer-neutral wording across tooling, docs and the console asset;
  repository URL in NOTICE; no em dash, en dash or ellipsis characters in
  the integrity tooling.

## [0.3.0] - 2026-07-16

- Content: flat synonym and antonym strings become a real concept graph:
  concept_relations edges (synonym/antonym/related) with a mutual-only
  automatic writer and a review queue for everything ambiguous. Relations
  may span any two CEFR levels (ADR 0003): the dictionary records the
  language, level pacing stays a consumer concern, and a wide span is an
  editorial advisory instead of a write blocker. The full queue was
  reviewed: the graph ships with 368 verified links. CONTRACT.md documents
  the new optional field; consumers that ignore it keep working.
- Content: decided pairs consume their flat strings (733 removed; the edge
  or the remembered reject is the record now). Dangling strings stay as
  answer support, ambiguous ones await sense hints, phrases stay by design.
  Edges are permanent: regeneration only adds, never drops. The content
  audit counts graph edges as synonym coverage so the autopilot does not
  refill what the graph already carries.
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
