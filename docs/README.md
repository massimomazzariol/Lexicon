# Documentation Index

This is the entrypoint for repository documentation.

Use this file to decide what to read next instead of guessing between guides,
reference docs, and policies.

## Folder Map

- `docs/guides/`
  Workflow and integration guides.

- `docs/reference/`
  Stable reference material such as file contracts and tool catalogs.

- `docs/policies/`
  Editorial and repository policy documents.

## Start Here

- [Consumer Guide](./guides/CONSUMER_GUIDE.md)
  Use this if you want to integrate Lexicon into an app or service.

- [Pack Authoring Workflow](./guides/PACK_AUTHORING.md)
  Use this if you want to edit source content, run the authoring pipeline, or
  generate runtime packs.

- [Entry Authoring Guide](./guides/ENTRY_AUTHORING.md)
  Use this when you want the practical rules for adding or repairing new words,
  especially noun surfaces, support fields, and source-pack guardrails.

- [Generate Workflow](./guides/GENERATE_WORKFLOW.md)
  Use this when you want to turn a single word request into the correct concept,
  related lexical items, and editorial updates.

- [Tools Catalog](./reference/TOOLS.md)
  Use this if you want to understand the role of each script under `tools/`.

- [Workflow Commands](./reference/WORKFLOW_COMMANDS.md)
  Use this when you want the canonical command list without hunting across
  multiple guides.

- [Releasing](./guides/RELEASING.md)
  Use this for release verification, tagging, and final publish steps.

## Reference And Policy

- [Distribution Contract](../CONTRACT.md)
  The distribution schema and the only consumer contract.

- [Content Changelog](./reference/CONTENT_CHANGELOG.md)
  Concept-first, language-neutral history of lexical additions and semantic
  splits.

- [Decision Log](./reference/DECISION_LOG.md)
  Why specific lexical/editorial choices were made, so later cleanup does not
  have to rediscover the reasoning.

- [Editorial Rules](./policies/EDITORIAL_RULES.md)
  Editorial QA policy for source content.

- [Lexical Rules](./policies/LEXICAL_RULES.md)
  Canonical policy for lexical modeling decisions such as variants,
  formatting-only duplicates, polysemy, and confusable support.

## Working Notes

- The current canonical source pack lives in `packs/lexicon_source`.
- The source manifest uses `pack_role: "source"` and tracks
  `languages_present` only; runtime study-language support is declared in
  generated runtime packs with `pack_role: "runtime"`.
- The canonical source content does not embed `study_units`; those are built as
  runtime-pack artifacts.
- The repository uses a language-neutral core/build architecture.
