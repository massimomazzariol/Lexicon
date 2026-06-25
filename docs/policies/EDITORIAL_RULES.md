# Editorial Rules

These rules apply to Lexicon source content authoring and editorial QA.
They are language-agnostic: language-specific plugins may extend build-time
behavior, but they do not change the editorial standard expected of source
content.

For lexical modeling decisions such as same-concept variants, formatting-only
duplicates, and polysemy/confusable boundaries, use
`docs/policies/LEXICAL_RULES.md` together with this file.

## Core Rules

1. Every concept-language row should have a `short_definition`.
2. Every concept-language row should have at least one example sentence, unless there is a deliberate editorial reason to defer it.
3. Examples must not spoil the target word.
   This includes the exact lexeme, its lemma, trivial article-stripped variants, and close inflectional echoes.
4. Synonyms are optional, not mandatory.
   If there is no robust synonym, leave `synonyms_json` empty.
5. Synonyms must not spoil the target word.
   Do not use the same word again as a "synonym", including bare formatting variants such as removing `to` or dropping the article.
6. If a variant must be accepted for grading, model it as a lexeme or form variant, not as a synonym.
7. Antonyms are optional, but every concept should have one of these:
   `antonyms_json` with a real antonym
   `antonym_policy_json` with `status: intentionally_none` and a reason
8. New concepts may receive an editorial CEFR placement, but if the level was not already present in the data, that placement must be marked for later review.
9. Italian nouns must keep learner-facing articles in editorial surfaces.
   Use `la casa`, `l'ora`, `il bimbo`, `le case`, not bare noun-only variants such as `casa`, `ora`, `bimbo`, `case` when the intended learner-facing form is a noun with article.

## Canonical Data Direction

- Source-pack data must be explicit.
- Do not rely on runtime fallback or article stripping to repair incomplete noun
  data.
- If a learner-facing noun form requires an article, store the exact form in
  the source data.
- If a distinct accepted variant is required, model it as a lexeme, form, or
  morphology override, not as a fake synonym.

## No-Spoiler Policy

- Do not place the target word in example sentences.
- Do not place the target word in `synonyms_json`.
- Do not use article-only or infinitive-marker-only stripping as a synonym strategy.
  Example: `to reach -> reach` is not an editorial synonym.
  Example: `the comparison -> comparison` is not an editorial synonym.
- Do not keep Italian noun duplicates whose only difference is dropping the article.
  Example: `l'ora -> ora` is not an acceptable editorial support strategy.

## Hard Guardrails

These checks are intentionally enforced by the toolchain:

- `upsert_pack_entries.mjs` rejects article-bearing noun entries that drop the
  article in canonical text or support fields
- `quality_clean_pack.mjs` rejects source data where noun/article invariants are
  already broken
- `generate_pack_forms.mjs` rejects noun-form generation when the same
  invariant is violated in source content or overrides

If one of these commands fails, fix the source data. Do not patch the runtime
to compensate.

## QA Command

Run the editorial audit on the source pack with:

```bash
node tools/pipeline/quality_clean_pack.mjs --pack-dir packs/lexicon_source --out-dir .tmp/editorial-audit
```

Use `--apply` only after reviewing the report and the affected rows.
By default the QA tool now emits example-authoring request files for missing
examples instead of generating filler sentences. Use
`--generate-missing-examples` only for an explicit temporary fallback pass.
