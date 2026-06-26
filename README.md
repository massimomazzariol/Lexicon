# Lexicon Platform

[![CI](https://github.com/massimomazzariol/Lexicon/actions/workflows/ci.yml/badge.svg)](https://github.com/massimomazzariol/Lexicon/actions/workflows/ci.yml)
[![Code License](https://img.shields.io/badge/code-Apache--2.0-blue.svg)](LICENSE)
[![Content License](https://img.shields.io/badge/content-CC%20BY%204.0-green.svg)](LICENSE-CONTENT.md)

Lexicon Platform is a standalone, reusable lexical content repository: a single
curated source of vocabulary, built into versioned runtime packs and published as
a file-based JSON distribution. Consumers integrate through that distribution
only. They never depend on this repository's source or build, and it never
reaches into a consumer (see `CONTRACT.md` and `docs/adr/`).

## Why this exists

Good lexical data for language learning does not exist in an open, reusable form.
What is public is scattered and inconsistent (definitions vary by source, examples
are uneven, CEFR levels are rarely coherent, and the relations between words are
mostly missing), and the few coherent datasets are locked inside proprietary apps.
Generating it live, per request, is slow, costly, non-deterministic, and
offline-hostile, and a learner cannot tell a good entry from a bad one.

Lexicon consolidates the knowledge once into a curated source of truth, then
materialises it into static, versioned, downloadable packs:

- **Deterministic and reviewable** - a word always returns the same vetted entry;
  the source is content-as-code, so every change is a reviewable diff.
- **Leveled and interconnected** - CEFR levels (A1 to C2) and concept relations are
  global judgments made once, not re-derived per request.
- **Static and cheap to serve** - consumers download prebuilt packs and serve them
  locally; no per-use generation, no live model call, no scaling cost.

Pay the curation cost once, serve quality forever.

## How it works

- **Content-as-code.** One curated source pack builds into versioned runtime packs
  plus the file-based distribution contract.
- **Capability-driven language plugins.** Morphology (German noun declension,
  separable verbs like `auf|stehen`) is rule-derived with curated irregulars; the
  core stays language-neutral, so a new language is a plugin, not a core change.
- **Reviewed, never auto-shipped.** Entries are staged `needs_review`; a guardrail
  gate promotes only the clean ones, the build excludes the rest, and the final
  check is the git diff.

## Authoring

Content is grown and tended from a single console (`pnpm run lexicon`):

![Lexicon console](docs/assets/lexicon-console.svg)

Nothing ships automatically: every record is reviewed (the git diff is the gate)
before it is built into a pack.

## Consuming the content

Integrate through one contract only: the file-based JSON distribution
(`root_manifest.json` + per-language indexes + per-pack `manifest.json` and
`content.json`). Every manifest carries `contract_version`, so a consumer detects
and rejects an incompatible distribution instead of drifting silently.

- **Build:** `pnpm run release` writes `dist/lexicon_distribution/`
- **Publish:** `pnpm run publish -- --publish --tag <tag>` uploads flat assets to a GitHub Release
- **Integrate:** parse the distribution per `CONTRACT.md` and `docs/guides/CONSUMER_GUIDE.md`

## Docs

- `CONTRACT.md` - the distribution contract (the only consumer contract)
- `docs/README.md` - documentation map and reading order
- `docs/guides/CONSUMER_GUIDE.md` - integrating the distribution
- `docs/guides/PACK_AUTHORING.md` - source-pack authoring workflow
- `docs/reference/WORKFLOW_COMMANDS.md` - canonical command reference
- `docs/guides/RELEASING.md` - release + publish checklist
- `CONTRIBUTING.md` - contribution guide

## Licensing

Code (`tools/`) is `Apache-2.0`; lexical content, packs, and docs are `CC BY 4.0`
unless noted otherwise, keeping the repository open and reusable while preserving
attribution. See `LICENSE`, `LICENSE-CONTENT.md`, `NOTICE`, `ATTRIBUTION.md`.
