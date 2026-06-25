# Changelog

All notable changes to this repository will be documented in this file.

## [Unreleased]

## [0.5.1] - 2026-03-27

### Fixed

- `lexicon_content_db` now prefers the stored canonical pack row id over stale
  `manifest_json.pack_id` values when reconstructing manifest entries, so
  legacy-to-canonical pack-id migrations do not leak `vokabell.*` ids back out
  through chunk catalogs.
- Added regression coverage for the migrated-pack manifest case in
  `lexicon_content_db_repository_test.dart`.

### Changed

- Bumped published package versions and consumer tag examples to `0.5.1` /
  `v0.5.1`.

## [0.5.0] - 2026-03-27

### Added

- Added the editorial `genera` tooling stack:
  - concept discovery preflight
  - concept coverage matrix
  - concept collision detector
  - unified generate brief
  - canonical one-command generate workflow
  - bounded related-word guardrails
- Added a dedicated multilingual content changelog in
  `docs/reference/CONTENT_CHANGELOG.md` so concept additions and semantic splits
  no longer need to live in the product/repository changelog.
- Added Italian grammar-unit generation in runtime packs through the Italian
  build-time plugin path.
- Added named plugin-capability summaries and requirement checks on both the
  Dart consumer side and the Node build side, plus a neutral capability audit
  report for the build-time registry.
- Added a unified consumer-side language-selection and pack-resolution
  contract in `lexicon_core`, so apps can ask the library for selected plugin
  languages, missing capabilities, and best runtime-pack matches in one step.
- Added an explicit `LexiconPackRole` contract so source manifests and runtime
  manifests are modeled differently in public APIs instead of relying on field
  shape alone.
- Added a shared `language_text_conventions` helper so article stripping,
  definiteness inference, and neutral fallback copy are centralized instead of
  being re-encoded inside individual pipeline scripts.

### Changed

- Improved lexical upsert safety while enriching existing concepts.
- Kept new editorial additions aligned with the no-spoiler workflow and
  concept-first generate contract.
- Reserved the root changelog for platform, package, tooling, and release
  history; concept-level lexical additions now belong in the dedicated content
  changelog.
- Split language-plugin add-ons out of the neutral `lexicon_platform` package:
  plugin packages must now be depended on and imported explicitly instead of
  being re-exported through umbrella compatibility sublibraries.
- Applied the hardcoded-assumption review rule to the package/plugin boundary
  and moved the remaining follow-up work to the language-neutrality backlog.
- Split source-pack and runtime-pack semantics in the manifest/document layer
  and made runtime catalog helpers ignore source packs by design.
- Completed the residual language-neutrality data migration review:
  runtime manifests now stamp `pack_role: "runtime"`, and generated
  `plugin_source` labels now use neutral provenance names instead of legacy
  `v2-*` generator markers.
- Bumped published package versions to `0.5.0` and aligned release metadata,
  docs, and consumer tag examples to `v0.5.0`.

## [0.4.0] - 2026-03-26

### Added

- Added `packages/lexicon_italian` as the second concrete language plugin
  package.
- Exported the Italian add-on surface from the platform package as an explicit
  optional plugin path.
- Bumped published package versions to `0.4.0`.

## [0.3.0] - 2026-03-26

### Added

- Added shared pack-catalog and pack-resolution contracts for consumers.
- Added repository hygiene and language-neutrality backlog tracking.
- Added CLI help coverage for maintained Node tools.
- Added level/part-of-speech reporting and lemma-column reporting utilities.

### Changed

- Renamed the canonical source pack to the neutral `lexicon.source` identity
  under `packs/lexicon_source`.
- Split source-pack semantics from runtime-pack semantics and removed
  source-embedded study generation artifacts.
- Moved German noun morphology, metadata curation, editorial ingest, and
  runtime grammar expansion behind the build-time language plugin registry.
- Neutralized reporting, QA labels, docs, tests, and examples away from
  German-first assumptions.
- Reorganized `tools/` and `docs/` into clearer, role-based structures.
- Centralized shared CEFR and `pack_id` conventions across Node and Dart code.

## [0.2.0] - 2026-03-20

### Added

- Published the official `lexicon_platform` umbrella package as the main
  integration entrypoint.
- Added file-based lexicon distribution artifacts and documentation for
  artifact-based delivery.
- Added a standalone local lexicon database and importer workflow.

### Changed

- Renamed canonical pack ids and generated packs to the `lexicon.*` naming
  family.
- Reworked repository documentation to present Lexicon as a standalone product.

## [0.1.0] - 2026-03-20

### Added

- First public Git tag.
- Introduced the initial reusable package boundary for lexical contracts,
  parsing, storage, and the German plugin.
- Added canonical source packs, generated runtime packs, and authoring tooling
  to the repository.
