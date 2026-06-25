# Workflow Commands

This file is the command reference for the repository.

Use it as the source of truth when `README.md`, `CONTRIBUTING.md`,
`docs/guides/PACK_AUTHORING.md`, or `docs/guides/RELEASING.md` need to point to
concrete commands without re-listing everything inline.

## Source Authoring

Preflight a single-word editorial request before editing:

```bash
pnpm node tools/reports/report_concept_discovery.mjs \
  --pack-dir packs/lexicon_source \
  --term spitze \
  --lang de
```

Inspect a concept directly after discovery:

```bash
pnpm node tools/reports/report_concept_coverage_matrix.mjs \
  --pack-dir packs/lexicon_source \
  --concept-id concept-a2-spitze-tip
```

Audit template answer support against what grading can really accept:

```bash
pnpm node tools/reports/report_answer_support_drift.mjs \
  --pack-dir packs/lexicon_source \
  --lang en \
  --limit 25
```

Review overloaded terms and split/merge candidates:

```bash
pnpm node tools/reports/report_concept_collisions.mjs \
  --pack-dir packs/lexicon_source \
  --lang de \
  --term spitze
```

Run the canonical one-command `genera` workflow:

```bash
pnpm node tools/reports/run_generate_workflow.mjs \
  --pack-dir packs/lexicon_source \
  --term spitze \
  --lang de \
  --out-file docs/data/generate_spitze.md
```

If you only want the raw structured brief:

```bash
pnpm node tools/reports/report_generate_brief.mjs \
  --pack-dir packs/lexicon_source \
  --term spitze \
  --lang de
```

Inspect the current build-time plugin capability surface:

```bash
pnpm node tools/reports/report_language_plugin_capabilities.mjs \
  --require-capability noun_morphology \
  --require-capability runtime_noun_slots
```

Run the canonical source pipeline (upsert → curate → sanitize → QA → nouns):

```bash
pnpm run pipeline
# or with entries to upsert first:
pnpm node tools/pipeline/run_pack_pipeline.mjs \
  --entries packs/templates/entries.sample.json \
  --with-forms
```

Dry run:

```bash
pnpm run pipeline:dry
# or with entries:
pnpm node tools/pipeline/run_pack_pipeline.mjs \
  --entries packs/templates/entries.sample.json \
  --dry-run \
  --with-forms
```

Apply editorial entries directly:

```bash
pnpm node tools/pipeline/upsert_pack_entries.mjs \
  --pack-dir packs/lexicon_source \
  --entries packs/templates/entries.sample.json
```

This command now hard-fails when article-bearing noun entries drop the
learner-facing article in canonical text, or when support fields use
formatting-only duplicates such as `l'ora -> ora` or `to eat -> eat`.

Curate source metadata:

```bash
pnpm node tools/pipeline/curate_pack_metadata.mjs \
  --pack-dir packs/lexicon_source
```

Run editorial QA in read-only mode:

```bash
pnpm node tools/pipeline/quality_clean_pack.mjs \
  --pack-dir packs/lexicon_source \
  --out-dir .tmp/editorial-audit
```

Run editorial QA:

```bash
pnpm node tools/pipeline/quality_clean_pack.mjs \
  --pack-dir packs/lexicon_source \
  --out-dir docs/data \
  --apply
```

This now writes example-authoring request files for missing examples instead of
inventing filler sentences.

If you explicitly want fallback example generation:

```bash
pnpm node tools/pipeline/quality_clean_pack.mjs \
  --pack-dir packs/lexicon_source \
  --out-dir docs/data \
  --apply \
  --generate-missing-examples
```

Request QA labels in a preferred language:

```bash
pnpm node tools/pipeline/quality_clean_pack.mjs \
  --pack-dir packs/lexicon_source \
  --out-dir docs/data \
  --label-lang it
```

## Runtime Packs And Distribution

Rebuild all 12 runtime packs from the canonical source (auto-bumps patch version when
content changes):

```bash
pnpm run rebuild
```

Rebuild + build the distribution in one shot:

```bash
pnpm run release
# Rebuilds the runtime packs and builds dist/lexicon_distribution/.
# Publishing the built distribution is a separate, explicit step (see below).
```

Serving/dev machine - pull the latest committed packs and rebuild the distribution
locally (no pack rebuild from source):

```bash
pnpm run refresh
# git pull -> build distribution.
```

Publish the built distribution to a GitHub Release (the only delivery channel;
consumers fetch it from there - see docs/adr/0004). Dry run by default; pass
--publish and a tag to actually create/update the Release:

```bash
pnpm run publish                              # dry run: prints the asset plan
pnpm run publish -- --publish --tag <tag>     # create/update the Release
```

Dry run to check what rebuild would produce without writing files:

```bash
pnpm node tools/pipeline/rebuild_runtime_packs.mjs --dry-run
```

Build a single runtime pack (low-level, for debugging):

```bash
pnpm node tools/pipeline/build_target_pack_from_source.mjs \
  --source-pack-dir packs/lexicon_source \
  --dest-pack-dir packs/lexicon_de_a1 \
  --pack-id lexicon.de.a1.seed \
  --target-lang de \
  --level A1 \
  --version 1.0.0
```

Build distribution artifacts only:

```bash
pnpm node tools/pipeline/build_lexicon_distribution.mjs \
  --packs-root packs \
  --out-dir dist/lexicon_distribution
```

## Node Verification

Run the most important Node-side checks:

```bash
node --test tools/lib/related_word_guardrails.test.mjs
node --test tools/lib/language_text_conventions.test.mjs
node --test tools/lib/generate_workflow_output.test.mjs
node --test tools/lib/generate_brief.test.mjs
node --test tools/lib/concept_collisions.test.mjs
node --test tools/lib/concept_coverage.test.mjs
node --test tools/lib/concept_discovery.test.mjs
node --test tools/lib/language_plugins/build_language_plugin_registry.test.mjs
node --test tools/pipeline/upsert_pack_entries.test.mjs
node --test tools/pipeline/quality_clean_pack.test.mjs
node --test tools/pipeline/generate_pack_forms.test.mjs
node --test tools/pipeline/build_target_pack_from_source.test.mjs
node --test tools/pipeline/build_lexicon_distribution.test.mjs
```

## Release Verification

Run the Node verification block, then build the distribution and publish it.

Typical release flow:

```bash
pnpm run release                              # build dist/lexicon_distribution/
git tag v0.1.0
git push origin main
git push origin v0.1.0
pnpm run publish -- --publish --tag v0.1.0    # upload the distribution assets
```
