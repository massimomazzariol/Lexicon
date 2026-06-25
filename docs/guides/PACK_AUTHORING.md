# Pack Authoring Workflow

Canonical content authoring lives in this repository.

Related docs:

- `docs/README.md`
- `docs/guides/CONSUMER_GUIDE.md`
- `docs/guides/ENTRY_AUTHORING.md`
- `docs/guides/GENERATE_WORKFLOW.md`
- `docs/policies/LEXICAL_RULES.md`
- `docs/reference/CONTENT_CHANGELOG.md`
- `CONTRACT.md`
- `docs/reference/WORKFLOW_COMMANDS.md`
- `docs/policies/EDITORIAL_RULES.md`
- `docs/reference/TOOLS.md`

Current split:

- `packs/lexicon_source` is the canonical multi-level source pack
- `packs/templates` contains editorial batch templates
- `packs/templates/README.md` defines the preferred `wave` naming for thematic
  editorial files
- generated lexical runtime packs now live in `packs/lexicon_*`
- application bundled assets are generated elsewhere from these runtime packs
- build-time language plugins can extend generation behavior, but the authoring
  workflow itself is defined at the neutral source-pack level, not by a single
  language plugin

## Source Manifest Semantics

The canonical source pack is not a runtime chunk, so its manifest uses
source-specific language fields:

- `pack_role: "source"`
- `languages_present`
  All language codes actually present in the source content.

Runtime manifests still use:

- `pack_role: "runtime"`
- `languages_target_supported`
- `gloss_languages_supported`

The canonical source content also stays free of embedded `study_units`. Study
generation belongs to runtime-pack build steps, not to the source pack itself.

The build and the distribution treat the two distinctly: runtime selection and
the published catalog ignore source packs by design (`pack_role: "source"`).

## Command Reference

The canonical command list lives in
`docs/reference/WORKFLOW_COMMANDS.md`.

This guide keeps only the authoring-focused commands inline.

## Entry Direction

For the field-level rules used when creating new words, use
`docs/guides/ENTRY_AUTHORING.md`.

In particular, keep these rules in mind when authoring nouns:

- the source pack is the canonical truth, so missing or wrong noun surfaces
  should be fixed in source data, not hidden behind runtime behavior
- accepted answer variants belong in lexeme/form data, not in
  `synonyms_json`
- for article-bearing noun languages, learner-facing editorial surfaces must
  keep the article
- the toolchain now hard-fails on violations during upsert, editorial QA, and
  noun-form generation

## One-command source pipeline

```bash
pnpm node tools/pipeline/run_pack_pipeline.mjs \
  --pack-dir packs/lexicon_source \
  --entries packs/templates/entries.a2_curation_batch_02_mixed.json \
  --with-forms
```

The pipeline already runs `quality_clean_pack`, so editorial QA is part of the
default authoring flow.
In particular:
- examples must not spoil the target word
- missing examples now produce authoring-request files by default instead of
  silent filler sentences
- `synonyms_json` must not be used for bare answer variants such as dropping
  `to` or removing an article
- accepted answer variants should be modeled as lexeme or form variants
- noun/article invariants are enforced before runtime-pack generation continues

For single-word expansion requests such as `genera Vergleich` or
`genera pulire`, use `docs/guides/GENERATE_WORKFLOW.md` as the contract for
what the request should produce before you turn it into pack edits.
For notable concept additions or semantic splits, record the result in
`docs/reference/CONTENT_CHANGELOG.md` rather than in the root `CHANGELOG.md`.

Dry run:

```bash
pnpm node tools/pipeline/run_pack_pipeline.mjs \
  --pack-dir packs/lexicon_source \
  --entries packs/templates/entries.a2_curation_batch_02_mixed.json \
  --dry-run \
  --with-forms
```

## Upsert editorial entries

```bash
pnpm node tools/pipeline/upsert_pack_entries.mjs \
  --pack-dir packs/lexicon_source \
  --entries packs/templates/entries.sample.json
```

## Curate and clean source metadata

```bash
pnpm node tools/pipeline/curate_pack_metadata.mjs \
  --pack-dir packs/lexicon_source
```

```bash
pnpm node tools/pipeline/quality_clean_pack.mjs \
  --pack-dir packs/lexicon_source \
  --out-dir docs/data \
  --apply
```

If you explicitly want temporary fallback examples for a technical cleanup pass,
add:

```bash
pnpm node tools/pipeline/quality_clean_pack.mjs \
  --pack-dir packs/lexicon_source \
  --out-dir docs/data \
  --apply \
  --generate-missing-examples
```

## Backend publishing

Backend publishing remains outside this repository because hosting and delivery
are integration concerns, not lexicon-platform concerns.

For runtime-pack builds, distribution output, and asset sync commands, use
`docs/reference/WORKFLOW_COMMANDS.md`.
