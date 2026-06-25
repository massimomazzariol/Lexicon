# Contributing

Thanks for contributing to Lexicon Platform.

## What Contributions Are Welcome

- lexical content improvements
- new entries and corrections
- language plugin improvements
- tooling and build pipeline fixes
- storage/import improvements
- documentation and examples

## Basic Flow

1. Fork the repository or create a topic branch.
2. Make a focused change.
3. Run the relevant local checks.
4. Open a pull request with a short verification summary.

## Local Checks

For release-level verification, see `docs/guides/RELEASING.md`.
For the canonical command list, see `docs/reference/WORKFLOW_COMMANDS.md`.

Run the relevant checks for the files you changed:

- Node pipeline or build changes:
  use the Node verification block from
  `docs/reference/WORKFLOW_COMMANDS.md`
- Dart package changes:
  run the package-specific block from
  `docs/reference/WORKFLOW_COMMANDS.md`
- Docs-only changes:
  verify links, examples, and referenced paths locally

## Structural Changes

If your change moves files, renames scripts, updates contributor workflow, or
touches shared conventions:

- keep the change focused and reviewable
- make sure docs entrypoints still point to the right paths

Do not leave new hardcoded behavior undocumented:

- if it is a real shared product rule, centralize it
- if it is language-specific, move it behind a plugin or named capability
- if it is only a temporary shortcut, record it in the right backlog with a
  follow-up plan

## Content Contributions

If you want to improve lexical content:

- prefer editing canonical source packs and templates
- keep entries consistent with existing schema and level conventions
- include rationale when a change is linguistically ambiguous
- prefer small, reviewable batches over large unstructured dumps
- record notable concept additions or semantic splits in
  `docs/reference/CONTENT_CHANGELOG.md`
- keep the root `CHANGELOG.md` focused on platform, tooling, package, and
  release history rather than per-word content additions

## Licensing

By contributing, you agree that your contributions are made under the
repository licensing model:

- code under `Apache-2.0`
- content and documentation under `CC BY 4.0`

See:

- `LICENSE`
- `LICENSE-CONTENT.md`
- `ATTRIBUTION.md`
