# Tools Catalog

This file explains what lives under `tools/` and which scripts are part of the
normal workflow.

For the canonical command list, use `docs/reference/WORKFLOW_COMMANDS.md`.
All maintained CLI scripts under `tools/pipeline/`, `tools/reports/`, and
`tools/maintenance/` support `-h` / `--help`.

## Folder Layout

- `tools/pipeline/`
  Core build and authoring commands that contributors are expected to run.

- `tools/reports/`
  Read-only diagnostics and content inventory reports.

- `tools/maintenance/`
  Focused scripts for migration or cleanup tasks that are not part of the
  everyday workflow.

- `tools/lib/`
  Shared utilities imported by other tools, including build-time language
  plugin helpers for noun morphology, editorial ingest, and source metadata
  curation. This folder also owns stable repository conventions such as the
  shared CEFR/pack-id helpers in `tools/lib/lexicon_conventions.mjs` and the
  editorial noun/article guardrails in `tools/lib/editorial_invariants.mjs`.
  These are not direct CLIs.

## Pipeline Tools

- `tools/pipeline/run_pack_pipeline.mjs`
  Main authoring entrypoint. Orchestrates upsert, metadata curation, QA, noun
  generation, and optional asset sync.

- `tools/pipeline/upsert_pack_entries.mjs`
  Applies editorial batch entries into the canonical source pack, delegating
  language-specific ingest normalization to registered build-time plugins where
  available. It now hard-fails on formatting-only support duplicates such as
  dropping an article or stripping English `to` from an infinitive, and it also
  rejects article-bearing noun text that drops the learner-facing article.

- `tools/pipeline/curate_pack_metadata.mjs`
  Normalizes pack metadata after content edits and applies registered
  source-metadata curation plugins.

- `tools/pipeline/sanitize_pack_legacy_markers.mjs`
  Cleans outdated markers and legacy fields in source content.

- `tools/pipeline/quality_clean_pack.mjs`
  Runs editorial QA checks and can apply approved cleanup changes. Supports
  neutral multi-label report output, with optional `--label-lang` when a
  reviewer wants a preferred display language. By default it emits
  example-authoring request files for missing examples; fallback example
  generation is now explicit via `--generate-missing-examples`. It also
  hard-fails on source noun/article invariant violations before continuing.

- `tools/pipeline/generate_pack_forms.mjs`
  Generates noun forms and source-side morphology metadata for the canonical
  source pack. It refuses to propagate noun/article invariant violations from
  source content or morphology overrides.

- `tools/pipeline/build_target_pack_from_source.mjs`
  Builds a level-scoped runtime pack from the canonical source pack, using the
  registered build-time language plugins for noun slot inference and
  grammar-study expansion where available.

- `tools/pipeline/build_lexicon_distribution.mjs`
  Builds importer-ready distribution artifacts under `dist/`.

## Reports

- `tools/reports/report_pack_balance.mjs`
  Summarizes content distribution by domain, level, and part of speech.

- `tools/reports/report_noun_form_gaps.mjs`
  Diagnoses missing noun forms in the current source pack, with an optional
  reference language for comparison.

- `tools/reports/report_level_pos_counts.mjs`
  Counts lemmas by level and part of speech.

- `tools/reports/report_level_lemmas.mjs`
  Lists lemmas in level-based columns for quick review.

- `tools/reports/report_concept_discovery.mjs`
  Preflight report for single-word editorial requests. Given a term and an
  optional language filter, it surfaces exact lexeme/form hits, support-field
  hits, close matches, concept coverage gaps, and a first action hint such as
  `existing_concept_found` or `multiple_existing_concepts_review_split`.

- `tools/reports/report_concept_coverage_matrix.mjs`
  Concept-first coverage report. Given one or more concept ids, or a filter
  such as `--only-incomplete`, it shows DE / EN / IT coverage for lexemes,
  definitions, examples, core forms, synonyms, antonyms, and antonym policy.

- `tools/reports/report_answer_support_drift.mjs`
  Answer-support drift audit. It compares alias-bearing editorial templates
  against the support that grading can actually see in the current source pack:
  `concept_definitions.synonyms_json` plus same-concept active `exact`
  lexemes. Use it to find cases like template-approved alternates that never
  made it into live grading support.

- `tools/reports/report_concept_collisions.mjs`
  Collision and split-review report. Given a term, language, or concept filter,
  it surfaces overloaded terms and concept pairs that look more like
  polysemy/split cases or possible duplicate/merge cases.

- `tools/reports/report_generate_brief.mjs`
  Unified operational brief for `genera`. It composes discovery, coverage, and
  collision review into one structured output block for a single word request.

- `tools/reports/run_generate_workflow.mjs`
  Canonical one-command `genera` entrypoint. It wraps the unified brief,
  renders Markdown/table/JSON output, and can write a reusable brief artifact
  to disk with `--out-file`.

- `tools/reports/report_language_plugin_capabilities.mjs`
  Capability audit for the build-time plugin registry. It shows which named
  capabilities each language plugin currently exposes and can highlight missing
  capabilities against an explicit requirement list.

## Maintenance

- `tools/maintenance/apply_antonym_entries.mjs`
  Applies curated antonym/policy entries into source content. Keep this as a
  maintenance helper, not as part of the default contributor workflow.

## Tests

- `tools/lib/related_word_guardrails.test.mjs`
- `tools/lib/generate_workflow_output.test.mjs`
- `tools/lib/generate_brief.test.mjs`
- `tools/lib/concept_collisions.test.mjs`
- `tools/lib/concept_coverage.test.mjs`
- `tools/lib/concept_discovery.test.mjs`
- `tools/lib/language_plugins/build_language_plugin_registry.test.mjs`
- `tools/pipeline/upsert_pack_entries.test.mjs`
- `tools/pipeline/quality_clean_pack.test.mjs`
- `tools/pipeline/generate_pack_forms.test.mjs`
- `tools/pipeline/build_target_pack_from_source.test.mjs`
- `tools/pipeline/build_lexicon_distribution.test.mjs`

These cover the most important runtime-pack and distribution builder flows.
