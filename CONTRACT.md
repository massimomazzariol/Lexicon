# Lexicon Distribution Contract

`contract_version: 0.1.0`

This file is the single seam between the Lexicon platform (producer) and any
consumer. Lexicon publishes a **file-based JSON distribution**; consumers fetch
and parse it. Neither side depends on the other's source, build, or runtime
(see `docs/adr/`). If it is not described here, it is not part of the contract.

This document is kept byte-identical in the consumer repository. A small
**golden fixture** (`tools/fixtures/golden_distribution/`) is committed in both
repositories and exercised by conformance tests on both sides, so the two
copies cannot silently drift:

- Producer (this repo): `tools/lib/distribution_conformance.mjs` asserts the
  builder output and the golden fixture match this contract.
- Consumer: its importer parses the golden fixture and **rejects** an
  unsupported `contract_version`.

## Versioning

- `contract_version` is carried on every manifest object below.
- There is exactly one supported version at a time (`0.1.0`).
- A consumer that reads a `contract_version` it does not support **must reject**
  the distribution rather than guess. A missing `contract_version` is not valid.
- `0.1.0` is pre-stable: it is the minimum needed for a first consumer and is
  not yet a long-term compatibility promise.

## Distribution tree

```
root_manifest.json
indexes/<lang>.json
chunks/<lang>/<pack_id>/manifest.json
chunks/<lang>/<pack_id>/content.json
```

Paths inside the distribution always use `/`. `<lang>` is a lowercase code
(`de`, `it`, `en`). `<pack_id>` is the chunk id (e.g. `lexicon.de.a1.seed`).

## root_manifest.json

The tiny bootstrap file. Lets a consumer discover languages and compare
versions/hashes without downloading payloads.

```json
{
  "contract_version": "0.1.0",
  "generated_at": "<iso-8601>",
  "language_indexes": [
    {
      "contract_version": "0.1.0",
      "language_code": "de",
      "path": "indexes/de.json",
      "content_version": "2026.01.01",
      "content_hash": "sha256:<hex of the index file>",
      "updated_at": "<iso-8601>"
    }
  ]
}
```

## indexes/&lt;lang&gt;.json

Language-scoped discovery layer: points to chunk manifests without downloading
payloads.

```json
{
  "contract_version": "0.1.0",
  "language_code": "de",
  "generated_at": "<iso-8601>",
  "namespaces": [],
  "chunks": [
    {
      "contract_version": "0.1.0",
      "chunk_id": "lexicon.de.a1.golden",
      "manifest_path": "chunks/de/lexicon.de.a1.golden/manifest.json",
      "content_version": "1.0.0",
      "content_hash": "sha256:<hex of the payload file>",
      "levels_supported": ["A1"],
      "domains": ["food"],
      "updated_at": "<iso-8601>"
    }
  ]
}
```

## chunks/&lt;lang&gt;/&lt;pack_id&gt;/manifest.json

Describes one distributable chunk. It is the chunk's own pack manifest with the
contract fields merged on top. Required fields:

- `contract_version`
- `chunk_id` (equals the index pointer `chunk_id`)
- `language_code`
- `pack_id`, `version`
- `payload_path` (relative path to the chunk's `content.json`)
- `content_version`
- `content_hash` (`sha256:<hex>` of the payload file; equals the index pointer)
- `gloss_languages[]`
- `levels_supported[]`, `domains[]`, `relation_chunk_ids[]`
- `updated_at`

`content_hash` MUST equal the SHA-256 of the payload file it points at; this is
the integrity check.

## chunks/&lt;lang&gt;/&lt;pack_id&gt;/content.json (payload)

The chunk payload. Top-level arrays (each item is a flat record):

- `concepts[]`, `lexemes[]`, `lexeme_forms[]`, `examples[]`,
  `concept_definitions[]`, `clusters[]`, `cluster_members[]`
- `study_units[]` (prebuilt; consumed by the consumer's study layer, not by the
  lexical-content importer)

Records carry `pack_id`-scoped ids and the fields shown in the golden fixture
(`tools/fixtures/golden_distribution/chunks/de/lexicon.de.a1.golden/content.json`),
which is the canonical example of the payload shape. `*_json` fields may be a
JSON value or a pre-encoded JSON string.

Optional fields are additive and consumers MUST ignore unknown fields (the
`contract_version` does not bump for an added optional field). Current optional
field:

- `concept_definitions[].synonym_tiers_json` - a map `{ "<answer_text>":
  "exact" | "close" | "loose" }` giving each accepted alternative a correctness
  tier for partial-credit grading. Absent or untiered entries default to
  `"close"`. The primary translation is always `exact`. Keys are answer strings
  (they may be other concepts' words or free phrases), not lexeme ids.

## GitHub Release asset naming (flattened)

When the distribution is published to a GitHub Release, asset names cannot
contain a path separator, so each distribution-relative path is flattened by
replacing `/` with `__`:

```
root_manifest.json                          -> root_manifest.json
indexes/de.json                             -> indexes__de.json
chunks/de/lexicon.de.a1.seed/content.json   -> chunks__de__lexicon.de.a1.seed__content.json
chunks/de/lexicon.de.a1.seed/manifest.json  -> chunks__de__lexicon.de.a1.seed__manifest.json
```

The mapping is lossless and reversible: no path segment may contain `__`. A
consumer reverses it to map an incoming `/<rel-path>` request back to the flat
asset. Producer side: `tools/lib/distribution_release_assets.mjs` and
`tools/pipeline/publish_distribution_to_release.mjs`.
