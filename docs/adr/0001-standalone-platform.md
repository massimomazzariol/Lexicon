# ADR-0001: Lexicon is a standalone platform

- Status: Accepted
- Date: 2026-06-23
- Applies to: Lexicon
- Related: ADR-0002

## Context

Lexicon authors and builds vocabulary content and publishes it as a
self-contained, versioned JSON distribution, meant to be reusable by any
application or service. For that to hold, a consumer must be able to integrate
without ever depending on this repository's source, build, or runtime, and this
repository must never depend on or reach into a consumer. Anything else
(filesystem syncs, a shared code package, writing into a consumer's tree)
couples the two sides: a change on one side silently breaks the other, and
neither can be built or reasoned about on its own.

## Decision

**Lexicon is fully standalone. The only contract with a consumer is the
published JSON distribution. There is never a cross-reference or
cross-compilation between Lexicon and a consumer.**

- Lexicon builds and publishes content as a versioned JSON distribution and
  knows nothing about any specific consumer.
- A consumer fetches that distribution over HTTP and builds with no Lexicon repo
  or Lexicon package present.
- The ONLY contract is the published JSON distribution format (see ADR-0002 and
  `CONTRACT.md`). The shared thing is data, not code.

Locked sub-decisions:

1. **No shared code dependency.** A consumer integrates only via the
   distribution, never by depending on Lexicon's Dart packages or source.
2. **Distribution via GitHub Releases**, published as per-chunk assets with
   flattened names (see ADR-0002).
3. **Contract guard.** The distribution format is versioned (`contract_version`)
   and conformance-tested, so a consumer detects an incompatible version instead
   of drifting silently.

## Consequences

- Lexicon builds, tests, and ships on its own with nothing else on disk.
- A consumer may duplicate some content models or local schema. That duplication
  is accepted on purpose: the shared contract is the JSON format, not the code.
- A format change cannot silently break a consumer: the contract version and
  conformance tests fail CI first.
- A guard check ensures no path or package reference to a consumer repository
  appears in this repository.
