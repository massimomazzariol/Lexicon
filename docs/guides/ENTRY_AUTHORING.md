# Entry Authoring Guide

Use this guide when you are adding or repairing individual lexical entries in
the canonical source pack.

This is the shortest path to "how should I author a new word so the pack,
builder, and app stay aligned?"

Related docs:

- `docs/guides/PACK_AUTHORING.md`
- `docs/guides/GENERATE_WORKFLOW.md`
- `docs/policies/EDITORIAL_RULES.md`
- `docs/policies/LEXICAL_RULES.md`
- `docs/reference/WORKFLOW_COMMANDS.md`
- `docs/reference/TOOLS.md`

## Canonical Direction

Treat `packs/lexicon_source` as the source of truth.

For lexical decision-making, the canonical policy is now
`docs/policies/LEXICAL_RULES.md`.

- Put precise editorial data in the source pack.
- Do not rely on runtime fallback to "fix" incomplete lexical data.
- Do not use support fields as a workaround for missing canonical forms.
- If a required noun form is missing or wrong, fix the lexeme/form/override
  data and let the pipeline fail until it is explicit.

For accepted answer variants:

- use a real lexeme variant, form variant, or morphology override
- do not hide the variant inside `synonyms_json`
- do not create a bare duplicate by only stripping `to` or an article

## New Word Checklist

1. Run discovery first so you do not create an accidental duplicate or miss an
   existing split:

   ```bash
   pnpm node tools/reports/report_concept_discovery.mjs \
     --pack-dir packs/lexicon_source \
     --term spitze \
     --lang de
   ```

2. If the term already exists or looks split-relevant, inspect coverage:

   ```bash
   pnpm node tools/reports/report_concept_coverage_matrix.mjs \
     --pack-dir packs/lexicon_source \
     --concept-id concept-a2-spitze-tip
   ```

3. Author the template entry under `packs/templates/`.

4. Upsert the template into the source pack:

   ```bash
   pnpm node tools/pipeline/upsert_pack_entries.mjs \
     --pack-dir packs/lexicon_source \
     --entries packs/templates/entries.sample.json
   ```

5. Run source QA before applying broader pipeline steps:

   ```bash
   pnpm node tools/pipeline/quality_clean_pack.mjs \
     --pack-dir packs/lexicon_source \
     --out-dir .tmp/editorial-audit
   ```

6. Run the full authoring pipeline when the entry is ready:

   ```bash
   pnpm node tools/pipeline/run_pack_pipeline.mjs \
     --pack-dir packs/lexicon_source \
     --entries packs/templates/entries.sample.json \
     --with-forms
   ```

## Noun Rules

For article-bearing noun languages, the learner-facing article belongs in the
editorial surface.

Currently this is enforced as a hard guardrail for Italian nouns.

Good:

```json
{
  "translations": {
    "it": {
      "text": "la casa"
    }
  }
}
```

Bad:

```json
{
  "translations": {
    "it": {
      "text": "casa"
    }
  }
}
```

If you need explicit noun-form overrides, keep the article there too.

Good:

```json
{
  "lexeme_overrides": {
    "lexeme-it-house": {
      "forms": {
        "pl_core": "le case"
      }
    }
  }
}
```

Bad:

```json
{
  "lexeme_overrides": {
    "lexeme-it-house": {
      "forms": {
        "pl_core": "case"
      }
    }
  }
}
```

## Support Fields

Support fields are not a place to smuggle formatting variants.

Do not do this:

- `l'ora -> ora`
- `la casa -> casa`
- `the comparison -> comparison`
- `to reach -> reach`

If the system must truly accept an alternate answer, model it as lexical data.
Do not encode it as a fake synonym.

Reviewed boundary examples:

- keep `the male doctor` / `the female doctor` separate from generic
  `doctor`; if the generic form is needed, create a separate concept
- keep `il mattino` / `la mattina` together, but keep `il giorno` /
  `la giornata`, `la notte` / `la nottata`, `la sera` / `la serata`, and
  `l'anno` / `l'annata` separate by default
- when cross-language scope matters, label it explicitly, for example
  `to know (a person/place)` instead of a bare `know`
- if the broader English form must still be accepted, keep it as a reviewed
  secondary lexeme, not as the primary label
- do not flatten higher-register or higher-level words into A1 support:
  `to require`, `necessitare`, `proposal`, `deal`, `promozione`,
  `bellissimo`, and `carino` need their own review path
- keep neighboring senses apart even inside one topic:
  `the belly` vs `the stomach`, `stare seduto` vs `sedersi`, `to make` vs
  `to do`

Use this report to compare template support with what live grading can actually
see:

```bash
pnpm node tools/reports/report_answer_support_drift.mjs \
  --pack-dir packs/lexicon_source \
  --lang it \
  --limit 25
```

## What Fails Where

The repository now blocks bad noun/article data in multiple places:

- `tools/pipeline/upsert_pack_entries.mjs`
  Rejects template entries when support fields use formatting-only duplicates,
  such as `l'ora -> ora` or `to eat -> eat`. It also rejects Italian noun text
  that drops the learner-facing article.

- `tools/pipeline/quality_clean_pack.mjs`
  Rejects source-pack data when article-bearing noun surfaces are bare in
  `lexemes.text`, `lexeme_forms.surface`, `concept_definitions.synonyms_json`,
  or `lexeme_morphology_overrides`.

- `tools/pipeline/generate_pack_forms.mjs`
  Rejects noun-form generation if source noun surfaces or overrides violate the
  same invariant.

This is intentional. If one of these commands fails, fix the source data.
Do not patch the runtime to compensate.
