# ADR-0004: The published distribution is the only consumer contract

- Status: Accepted
- Date: 2026-06-23
- Applies to: Lexicon
- Related: ADR-0001

## Context

Lexicon builds a self-contained JSON distribution (`dist/lexicon_distribution/`): `root_manifest.json`, `indexes/<lang>.json`, and per-chunk `chunks/<lang>/<pack_id>/{manifest.json,content.json}`. Runtime packs are fully pre-rendered: all `lexeme_forms` and `study_units` are baked in at build time, so a consumer needs only to read the JSON, not run any Lexicon code.

Lexicon must reach consumers without reaching into them: it must not write into a consumer's tree or sync into a consumer's assets, since that couples the two and violates ADR-0001.

## Decision

The distribution is the ONLY thing Lexicon exposes to consumers, and it is published to a neutral location: **GitHub Releases of this repo**.

- Publish each distribution file as a separate, versioned Release asset. Because Release asset names are flat (no `/`), chunk paths are flattened, e.g. `chunks__de__lexicon.de.a1.seed__content.json`, `indexes__de.json`, `root_manifest.json`. The path-to-asset-name flattening scheme is part of the contract.
- The format is versioned via `contract_version` (and `schema_version` on manifests). It is documented in `CONTRACT.md` and guarded by a conformance test against a committed golden sample, so consumers can detect an incompatible version instead of breaking silently.
- No reach into a consumer: Lexicon publishes only to its own Releases. There is no script that writes into a consumer's tree or syncs into a consumer's assets. Lexicon never reads or writes a consumer repository and never builds a consumer.

## Consequences

- A consumer fetches the flattened Release assets and maps request paths to asset names. Lexicon does not know or care who the consumer is.
- Lexicon builds and publishes from a fresh clone with nothing else on disk.
- Changing the JSON shape or the flattening scheme is a contract change: bump `contract_version` and update `CONTRACT.md` + the golden fixture; the conformance tests on both sides enforce it.
