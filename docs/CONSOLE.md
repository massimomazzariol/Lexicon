# The console (`npm run lexicon`) and how to read a run

One command drives everything: **`npm run lexicon`** opens an interactive,
colored menu. There is no separate command to remember.

```
npm run lexicon                    # the menu (this console)
npm run lexicon -- --auto [flags]  # headless: run the autopilot, no menu (e.g. on a build box)
NO_COLOR=1 npm run lexicon         # turn colors off
```

## Content self-check (the "doctor")

The console checks content integrity **on entry** and heals it before showing the
menu; the autopilot does the same at the start of every run. So a publish can't
ship a pack the app rejects. It catches and fixes: duplicate concept / definition
/ lexeme rows (keeping the reviewed/richest), concepts with no difficulty score
(set from the level), and active words with no forms (minted via the form
generator). Run it directly any time:

```
npm run doctor            # report integrity problems (exit 1 if any)
npm run doctor -- --fix   # repair in place, then mint missing forms
```

## The menu

| # | Item | What it does |
|---|------|--------------|
| 1 | Add common words for a level | the AI suggests CEFR words; you pick which to keep |
| 2 | Find a word | check if a word already exists before adding - typos & similar words are caught |
| 3 | Add one specific word | type a word (typos ok); the AI corrects & connects it |
| 4 | Grow from gaps | add words other entries point to but that are still missing |
| 5 | **Autopilot** | runs on its own: fills, publishes & pushes live, chunk by chunk |
| 6 | Review AI suggestions | approve or reject the items waiting for a human |
| 7 | Status report | what is done and what still needs work |
| 8 | Publish | build the packs + push to GitHub so the app updates |

**Find before you add:** item `2` is a read-only, offline lookup. It tells you
whether a word is already a headword, already present as a synonym/antonym, or
just similar (a likely typo or neighbour) - matching is typo-tolerant, so
`machne` still finds `machen`. If nothing exact turns up it offers to add it.

**Autopilot is the everyday driver:** pick `5`, press Enter, and it runs
unattended (auto-publish + auto-push, ~20 words per chunk, resting the GPU
between them) until nothing is left to fill. Type `t` instead of Enter to change
the pacing. Ctrl-C stops it; it resumes where it left off.

## Reading the autopilot output

Each chunk runs in two phases. Several models **draft** candidates, then a judge
**keeps** the best of each. You see every word twice - once per candidate, once
at the judge:

```
12 word(s) to fill  ·  3 model(s) compete, a judge keeps the best
  legend: definitions / synonyms / examples · DE=German IT=Italian EN=English

▸ candidate A - drafting...
  [1/12] der Vertrag ... definitions DE IT · synonyms 3 · examples DE IT EN
  [2/12] verbindlich ... nothing usable

▸ judge - picking the best of each...
  [1/12] der Vertrag ... ✓ kept ...

✓ 11 word(s) updated  ·  +8 definitions, 3 rewritten, +25 examples
```

What the per-word line means - it is the list of what was produced for that word:

- **definitions DE IT** - wrote the short definition in German and Italian
- **synonyms 3** - proposed 3 synonyms
- **examples DE IT EN** - wrote example sentences in German, Italian and English
  (the learner sees the German sentence plus its Italian/English translation)

Important: under a **candidate** these are only *proposals*. Only what shows up
after **`✓ kept`** at the judge is actually written into the content. `DE`, `IT`,
`EN` are the languages (German / Italian / English).

Colors (a terminal only; off in logs and with `NO_COLOR`): phase headers and the
judge in cyan, definitions/kept/done in green, examples in blue, warnings in
yellow, errors in red.

## After a run

- The Autopilot publishes and pushes per chunk, so content reaches GitHub as it
  works. On the serving machine, `npm run refresh` pulls it and the app updates.
- Nothing risky ships unreviewed: drafted records are `needs_review`; only the
  clean, corroborated ones are auto-promoted (menu item 6 shows the rest).
