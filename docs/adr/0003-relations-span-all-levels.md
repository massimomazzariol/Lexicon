# ADR 0003: Concept relations span all CEFR levels

Date: 2026-07-16
Status: accepted

## Context

The concept graph (`concept_relations`) initially enforced a level-adjacency
rule at write time: an edge could only connect concepts at most one CEFR
level apart. The rationale was twofold: wide spans often indicate a
mis-leveled concept, and a consumer could otherwise surface an advanced word
to a beginner.

In practice the rule blocked legitimate lexical facts. "klar" (A2) and
"ambivalent" (C2) are antonyms whether or not a learner is ready for both;
a dictionary that refuses to record that is describing the learner, not the
language. Roughly a quarter of the reviewed link candidates were held back
by span alone.

The consumer-side concern turned out to be already solved by construction:
packs are distributed per level, and the distribution contract makes an
edge inert when its other endpoint is not present. A consumer that has not
loaded the C2 pack never surfaces the C2 word; the link activates by itself
once that pack is loaded.

## Decision

- The graph records relations between concepts at ANY two levels. The
  write-time adjacency rule is removed everywhere (automatic writer, review
  queue decisions, integrity invariants).
- Level pacing is a consumer concern. The contract already gives consumers
  the tool: load only the packs you want to serve; edges into unloaded
  packs are inert.
- A wide span remains an editorial SIGNAL: the analyzer reports written
  pairs spanning 2+ levels in a `levelCheck` advisory list, because a wide
  span still often means one concept sits at the wrong level. It warns; it
  no longer blocks.

## Consequences

- The dictionary is complete: antonym and synonym pairs across distant
  levels are first-class data.
- Consumers that ignore `concept_relations` are unaffected. Consumers that
  use it need no change if they follow the contract's inert-endpoint rule.
- The `wide_span` review-queue bucket is now always empty (kept in the
  queue file format for compatibility).
- Mis-leveled concepts are surfaced by the advisory report instead of being
  silently blocked from linking.
