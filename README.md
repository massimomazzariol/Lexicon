# Lexicon Platform

[![CI](https://github.com/massimomazzariol/Lexicon/actions/workflows/ci.yml/badge.svg)](https://github.com/massimomazzariol/Lexicon/actions/workflows/ci.yml)
[![Code License](https://img.shields.io/badge/code-Apache--2.0-blue.svg)](LICENSE)
[![Content License](https://img.shields.io/badge/content-CC%20BY%204.0-green.svg)](LICENSE-CONTENT.md)

Lexicon Platform is a reusable lexical content repository. It contains the
canonical source material, language plugins, runtime pack builders, local
lexicon storage, and the file-based distribution contract needed to ship
language data into an application or service.

It is a standalone platform. Consumers integrate through one thing only: its
published, versioned distribution. They never depend on this repository's source
or build, and this repository never reaches into a consumer (see `docs/adr/`).

## Why This Exists

Lexical knowledge for language learning is scattered and inconsistent: definitions
vary by source, examples are uneven, CEFR levels are rarely assigned coherently, and
the relations between words (synonyms, antonyms, sense families) are mostly missing.
Assembling that live, per request, would be slow, costly, non-deterministic and
offline-hostile... and a learner cannot tell a good entry from a bad one.

Lexicon solves this by **consolidating** the knowledge once into a single curated
source of truth, then **materialising** it into static, versioned, downloadable packs.
The payoff:

- **Deterministic and reviewable.** A word always returns the same vetted entry.
  Quality is fixed once and only improves; the source is content-as-code, so every
  change is a reviewable diff and nothing ships unreviewed.
- **Leveled and interconnected, consistently.** CEFR levels (A1→C2) and concept
  relations are global judgments made once and anchored to authoritative references,
  not re-derived each time - which is exactly where ad-hoc generation is least reliable.
- **Static, cacheable, predictable cost.** Consumers download the prebuilt packs once
  and serve them locally; there is no per-use generation and no live model call, so it
  scales to any number of users without scaling cost.
- **A self-contained distribution**, not a live dependency on a generation service.

In short: pay the curation cost once, serve quality forever.

## Engineering highlights

- **Content-as-code, deterministic packs.** A single curated source is built into
  versioned runtime packs plus a file-based distribution contract. The same word
  always returns the same vetted entry; every change is a reviewable diff.
- **Capability-driven language plugins.** Language behaviour (noun declension,
  separable-verb decomposition, ...) lives in per-language plugins that advertise
  capabilities. The core stays language-neutral, so adding a language is a plugin,
  not a core change.
- **Deterministic morphology + curated irregulars.** German noun declension and
  separable-verb decomposition (`auf|stehen`) are rule-derived; irregulars come from
  curated overrides, never guessed. Stable form ids keyed on the grammatical slot so
  surface edits never orphan a learner's progress.
- **Self-optimising model selection, nothing hardcoded.** When several local models
  are installed, a dueling-bandit learns from an LLM judge's per-field preferences and
  routes work to whichever model is best on *this* content, exploring across runs.
- **Human-gated generation.** Nothing AI-drafted ships unreviewed: records are
  `needs_review`, a guardrail gate auto-promotes only the clean, corroborated ones, and
  the build excludes the rest.
- **Static distribution, predictable cost.** Prebuilt packs are downloaded and cached
  by the consumer; no per-use generation and no live model call, scaling to any number
  of users without scaling cost.

## Authoring & quality

Contributors grow the source pack by proposing entries (see `authoring/`). To make that
fast, the repo ships an **optional local toolchain** for anyone running a local language
model: it can draft entries and fill gaps, and - when several models are installed - a
self-optimising selector (a dueling-bandit that learns from a judge's per-field
preferences) routes work to whichever model is actually best on *this* content, with no
hardcoded model choices.

Nothing generated ships automatically. Every drafted record is marked `needs_review`; a
guardrail gate auto-promotes only the clean ones and holds the rest for a human, and the
pack build excludes anything still under review. The reviewer's final check is the git
diff. Details in `authoring/README.md`.

The toolchain is driven by a single console - `npm run lexicon` - with an
interactive menu and an unattended autopilot. How to use it and how to read a run
(the `definitions / synonyms / examples DE IT EN` output) are documented in
`docs/CONSOLE.md`.

## What It Contains

- canonical source packs
- editorial templates and authoring tools
- generated runtime packs
- file-based distribution artifacts

## Start Here

- `docs/README.md`: documentation map and reading order
- `docs/guides/CONSUMER_GUIDE.md`: integration model for applications and services
- `docs/guides/PACK_AUTHORING.md`: source pack authoring workflow
- `CONTRACT.md`: the distribution contract (the only consumer contract)
- `docs/reference/TOOLS.md`: tool catalog and workflow roles
- `docs/reference/WORKFLOW_COMMANDS.md`: canonical command reference
- `CHANGELOG.md`: platform, tooling, package, and release history
- `docs/reference/CONTENT_CHANGELOG.md`: concept-first lexical-content history
- `docs/guides/RELEASING.md`: release checklist and verification flow
- `CONTRIBUTING.md`: contribution guide

## Repository Layout

- `docs/README.md`
- `docs/guides/`
- `docs/reference/`
- `docs/policies/`
- `packs/templates/`
- `packs/lexicon_source/` current canonical source pack
- `packs/lexicon_*_{a1,a2,b1,b2}/`
- `tools/pipeline/`
- `tools/reports/`
- `tools/maintenance/`
- `tools/lib/`

## Consuming The Content

Consumers integrate through one contract only: the **file-based JSON distribution**
(`root_manifest.json` + per-language indexes + per-pack `manifest.json` and
`content.json`). They never depend on this repository's source or build, and this
repository never reaches into a consumer.

- **Build** the distribution: `pnpm run release` (writes `dist/lexicon_distribution/`).
- **Publish** it: `pnpm run publish -- --publish --tag <tag>` uploads each distribution
  file as a flat asset to a GitHub Release.
- **Integrate** it: fetch and parse the distribution per `CONTRACT.md` and
  `docs/guides/CONSUMER_GUIDE.md`.

Every manifest carries `contract_version`, so a consumer can detect and reject an
incompatible distribution instead of drifting silently.

## Development Commands

Use [docs/reference/WORKFLOW_COMMANDS.md](docs/reference/WORKFLOW_COMMANDS.md)
as the command source of truth.

Typical source-pack entrypoint:

```bash
pnpm node tools/pipeline/run_pack_pipeline.mjs \
  --pack-dir packs/lexicon_source \
  --with-forms
```

Detailed workflow:
- `docs/guides/PACK_AUTHORING.md`
- `docs/reference/TOOLS.md`

## Licensing

Lexicon Platform uses a permissive split:

- code in `packages/`, `tools/`, and local demo code is licensed under
  `Apache-2.0`
- lexical content, packs, and documentation are licensed under `CC BY 4.0`
  unless noted otherwise

This is intended to keep the repository open, reusable, and easy to extend,
including in proprietary software, while preserving attribution to the source
project.

See:

- `LICENSE`
- `LICENSE-CONTENT.md`
- `NOTICE`
- `ATTRIBUTION.md`

For the end-to-end integration flow, including local DB import, distribution,
and hosting options, see `docs/guides/CONSUMER_GUIDE.md`.
