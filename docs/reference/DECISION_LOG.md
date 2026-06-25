# Decision Log

This file records why a lexical or editorial decision was taken.

Use it when a choice:

- closes an ambiguity that would otherwise come back later
- sets a modeling rule that should be reused for future words
- splits or scopes a concept in a non-obvious way
- explains why something was removed from support, synonyms, or examples

This is not a changelog and not a backlog.

- use `CONTENT_CHANGELOG.md` for merged content history

## Entry Shape

Use this template for new entries:

```md
## DL-XXX - Short Title

Date: `YYYY-MM-DD`
Status: `active/superseded`

Decision:
- `...`

Why:
- `...`

Impacts:
- `concept ids / template files / pack files`

Follow-up:
- `...`
```

## Decisions

## DL-001 - Italian Noun Surfaces Keep The Article

Date: `2026-04-21`
Status: `active`

Decision:
- Italian noun editorial surfaces keep the article.
- Bare noun variants such as `auto`, `casa`, or `medico` are not accepted when
  the canonical surface is `l'auto`, `la casa`, or `il medico`.

Why:
- Removing the article creates fake alternates instead of real lexical
  variants.
- Rebirth was surfacing inconsistent Lexicon data rather than inventing the
  issue at runtime.

Impacts:
- `packs/lexicon_source/content.json`
- `packs/lexicon_source/lexeme_morphology_overrides.json`
- noun QA and build guardrails

Follow-up:
- Keep enforcing this through source-pack QA and noun generation tests.

## DL-002 - Formatting-Only Duplicates Are Not Lexical Support

Date: `2026-04-21`
Status: `active`

Decision:
- Forms such as `l'auto -> auto` and `to eat -> eat` are not modeled as
  synonyms, aliases, or fallback support.

Why:
- They are the same item with grammar stripped off, not a second lexical form.
- Keeping them as support hides a modeling problem and pollutes editorial data.

Impacts:
- `tools/lib/editorial_invariants.mjs`
- `tools/pipeline/upsert_pack_entries.mjs`
- `tools/pipeline/quality_clean_pack.mjs`

Follow-up:
- Continue auditing legacy templates for the same pattern.

## DL-003 - Scoped Concepts Stay Scoped

Date: `2026-04-21`
Status: `active`

Decision:
- When a concept is intentionally scoped, support must not flatten it into a
  broader neighboring meaning.
- A reviewed broad form may exist as support only when the scope is still
  visible and the neighboring concept stays separate.

Why:
- Some languages use one broad form where another language forces a split.
- Flattening the boundary makes grading permissive in the wrong places and
  weakens the Lexicon model.

Impacts:
- `the male doctor` vs `the female doctor` vs generic `doctor`
- `to know (a person/place)` vs `to know = sapere`

Follow-up:
- Keep reviewed support explicit and documented instead of silently broad.

## DL-004 - Time Pairs Need Boundary Review

Date: `2026-04-21`
Status: `active`

Decision:
- `il mattino / la mattina` may live together.
- `il giorno / la giornata`, `la notte / la nottata`, and `l'anno / l'annata`
  stay separate by default.
- `la sera / la serata` is not merged automatically and should be reviewed
  manually if needed.

Why:
- Some pairs are near-equivalent in normal usage, others shift toward eventive,
  experiential, or marked readings.

Impacts:
- `packs/templates/entries.a1_curation_batch_15_time.json`
- reviewed semantic boundary tests

Follow-up:
- Reuse this rule when similar Italian pairings show up later.

## DL-005 - Gender-Marked Doctor Concepts Do Not Accept Generic Doctor By Default

Date: `2026-04-21`
Status: `active`

Decision:
- `the male doctor` and `the female doctor` stay separate.
- Generic `doctor` is not accepted automatically for either concept.
- If needed, generic `the doctor` should be modeled as its own concept.

Why:
- A generic answer does not encode the scoped gender distinction that those two
  concepts currently carry.

Impacts:
- `packs/templates/entries.a1_curation_batch_20_health.json`
- related source-pack support rows

Follow-up:
- Create a generic doctor concept only if we truly need it.

## DL-006 - `kennen` Is Modeled As `to know (a person/place)`

Date: `2026-04-21`
Status: `active`

Decision:
- The English primary label for `kennen` is `to know (a person/place)`.
- Bare `to know` may stay as reviewed support, but the concept remains separate
  from `wissen / sapere`.

Why:
- English compresses two meanings that Italian and German keep apart more
  clearly.
- The scope needs to stay visible in the primary label.

Impacts:
- concept `c5163d51-2abb-04e1-8ccf-36cb1fd312a9`
- `packs/templates/entries.a1_curation_batch_17_family.json`

Follow-up:
- Keep support reviewed, not automatic, whenever `to know` risks collapsing two
  concepts.

## DL-007 - `belly` And `stomach` Are Separate Concepts

Date: `2026-04-21`
Status: `active`

Decision:
- The existing `Bauch` A1 body concept is modeled as `the belly / la pancia`.
- `the stomach / lo stomaco` is treated as a separate organ concept if and when
  we need it.

Why:
- The old entry mixed body region and internal organ readings.

Impacts:
- concept `a0faf9d1-ed1c-9f28-6d77-f8ebbb94f052`
- `packs/templates/entries.a1_curation_batch_13.json`
- `packs/templates/entries.a1_curation_batch_20_health.json`

Follow-up:
- Review `l'addome` separately instead of merging it by habit.

## DL-008 - `sitzen` Maps To State, Not Movement

Date: `2026-04-21`
Status: `active`

Decision:
- The Italian side of the current concept uses `stare seduto` as primary.
- `sedersi` is not kept as the main equivalent for this state/posture concept.

Why:
- The concept definition and examples describe a seated state, not the movement
  of sitting down.

Impacts:
- concept `87a180ff-f265-430e-bc0b-161b8604d068`
- related source examples and support rows

Follow-up:
- Model `sedersi / to sit down` separately when that motion sense is needed.

## DL-009 - `fahren` Was Narrowed To `to drive / guidare`

Date: `2026-04-21`
Status: `active`

Decision:
- The current A1 concept was cleaned toward `to drive / guidare`.
- Broader movement-by-vehicle meanings such as `ride` or `travel by vehicle`
  are not kept inside this concept by default.

Why:
- The old concept mixed operating a vehicle with moving by vehicle more
  generally.

Impacts:
- concept `4a751289-0ae5-d62d-cd17-6b0c7c5e65be`
- `packs/templates/entries.a1_curation_batch_18_travel.json`

Follow-up:
- Decide later whether the broader movement branch deserves its own concept.

## DL-010 - `überhaupt` Was Split By Function

Date: `2026-05-24`
Status: `active`

Decision:
- The old mixed `überhaupt` concept was split by function.
- The existing concept now keeps the negative-emphasis branch
  `überhaupt / at all / per niente`.
- A separate concept covers the broad/generalizing branch
  `überhaupt / in general / in generale`.
- A separate concept covers the emphatic-question branch
  `überhaupt / even (in emphatic questions) / poi (in domande enfatiche)`.

Why:
- The old entry mixed at least three readings that are not interchangeable.
- The Italian negative primary was set to `per niente`, with `affatto` kept as
  a nearby same-branch variant instead of as the canonical label.
- The question-particle branch must stay separate from existing concepts such
  as `sogar = even` and `poi = then`.

Impacts:
- concept `e26099e6-6292-9c2d-6b9a-69cf996ba8f7`
- `concept-a2-ueberhaupt-general`
- `concept-a2-ueberhaupt-emphatic-question`
- `packs/templates/entries.a2_wave_ueberhaupt_split.json`

Follow-up:
- Keep future support variants scoped so the three branches do not collapse
  back together.

## DL-011 - `zumindest` And `mindestens` Use Different Italian Primaries

Date: `2026-05-25`
Status: `active`

Decision:
- `mindestens` (A2) keeps `almeno` as its Italian primary - it is the
  straightforward quantitative equivalent.
- `zumindest` (B1) now uses `perlomeno` as its Italian primary, reflecting the
  concessive/argumentative register of the German word.
- `almeno` is added as a secondary lexeme on `zumindest` with
  `meaning_status: "approximate"` to acknowledge the overlap for grading.
- `at the very least` is added as a secondary English lexeme on `zumindest`
  with `meaning_status: "approximate"` - it shares the more emphatic register.

Why:
- Both concepts mapped to `almeno` and `at least`, creating a grading collision
  where learner answers could not be distinguished.
- The German distinction is clear: `mindestens` is quantitative, `zumindest`
  is typically concessive or hedging.
- Italian `perlomeno` and English `at the very least` carry the same hedging
  register that `zumindest` signals.

Impacts:
- concept `2e15a945-9821-6cd1-ef18-663740b7bee6` (zumindest, B1)
- concept `concept-a2-mindestens` (mindestens, A2) - no change to the concept
  itself, only resolved via the `zumindest` update

Follow-up:
- Review `quantomeno` as a potential C1-level variant of `perlomeno` if and
  when the register distinction becomes important.

## DL-012 - `überhaupt` (general / broad sense) Is B1, Not A2

Date: `2026-05-25`
Status: `active`

Decision:
- `concept-a2-ueberhaupt-general` (`level_override: "B1"`) is now treated as B1.
- The concept ID retains the historical `a2` slug but the effective level is B1.
- German examples now use the target word in sentence position
  (`Überhaupt trinke ich selten Kaffee, ich bevorzuge Tee.`).
- Italian and English examples now include the primary lexeme in context
  (`in generale`, `in general`).

Why:
- The discourse-level broadening use of `überhaupt` ("Überhaupt trinke ich
  wenig Kaffee." - in general, broadly speaking) requires learners to
  recognize a non-literal sentence-initial use of an adverb. That is not
  a beginner-level skill.
- The word appears at that frequency only at mid-intermediate and above in
  authentic materials.
- The negative-emphasis sense (`gar nicht / überhaupt nicht`) stays at A2
  because learners encounter it much earlier.

Impacts:
- `packs/lexicon_source/content.json` - `level_override` field on concept
- B1 runtime packs that include this concept (next build cycle)
- A2 runtime packs that previously included it (next build cycle, concept removed)

Follow-up:
- Review Italian `in generale` (`meaning_status: "approximate"`) - the
  Italian side correctly reflects that there is no single-particle
  equivalent for the German discourse use. No change needed now.
