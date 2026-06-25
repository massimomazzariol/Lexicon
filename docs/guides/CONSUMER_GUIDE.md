# Consuming the Lexicon Platform

This repository is reusable across different applications and services. It
authors lexical content and publishes it as a self-contained, versioned JSON
distribution.

A consumer integrates through **one contract only: the published JSON
distribution** (see `CONTRACT.md`). A consumer never depends on this
repository's source, build, or Dart packages, and this repository never reaches
into a consumer (ADR-0001). The shared thing is data, not code: you parse the
JSON into whatever storage and runtime your app already uses.

## The distribution

Build it:

```bash
pnpm node tools/pipeline/build_lexicon_distribution.mjs \
  --packs-root packs \
  --out-dir dist/lexicon_distribution
```

The generated tree:

- `root_manifest.json`
- `indexes/<lang>.json`
- `chunks/<lang>/<pack_id>/manifest.json`
- `chunks/<lang>/<pack_id>/content.json`

Runtime packs are fully pre-rendered: all forms and study units are baked in at
build time, so a consumer only reads JSON, it never runs morphology or any
Lexicon code. The authoritative format (every field, the `contract_version`
semantics, and the flattened Release-asset naming) is `CONTRACT.md`.

## Publishing

Publish the built distribution to this repo's GitHub Releases (each file becomes
a flat per-file asset):

```bash
pnpm run publish -- --publish --tag <tag>
```

A consumer fetches those assets (mapping its request paths to the flattened
asset names per `CONTRACT.md`). The platform does not require any specific
backend and does not know who the consumer is.

## Minimal client flow

1. Fetch `root_manifest.json` and check its `contract_version` against the one
   your client supports; reject an unsupported version instead of guessing.
2. Read the language index you need (`indexes/<lang>.json`).
3. Pick the runtime chunks for the current language / level / topic.
4. Fetch `chunks/<lang>/<pack_id>/manifest.json`, then the referenced
   `content.json`.
5. If the manifest lists `relation_chunk_ids`, fetch those prerequisite chunks
   too.
6. Verify each chunk's `content_hash` against its payload, then load the rows
   into your own storage.

## Recommended consumer architecture

1. **Source and build** (this repo): author source packs, generate runtime
   packs, build the distribution.
2. **Hosting** (this repo's Releases, or any static host / object store): the
   distribution is published here.
3. **App-local store** (the consumer): download the chunks you need and import
   them into whatever local database your app uses. The shape of each
   `content.json` table is documented in `CONTRACT.md` and exercised by the
   golden fixture.

This keeps the platform file-based and backend-agnostic while the consumer owns
its runtime and storage.
