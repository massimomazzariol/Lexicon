# The console (`pnpm run lexicon`) and how to read a run

One command drives everything: **`pnpm run lexicon`** opens an interactive,
colored menu. There is no separate command to remember.

```
pnpm run lexicon                    # the menu (this console)
pnpm run lexicon -- --auto [flags]  # headless: run the autopilot, no menu (e.g. on a build box)
NO_COLOR=1 pnpm run lexicon         # turn colors off
```

## Content self-check (the "doctor")

The console checks content integrity **on entry** and heals it before showing the
menu; the autopilot does the same at the start of every run. So a publish can't
ship a pack a consumer would reject. It catches and fixes: duplicate concept / definition
/ lexeme rows (keeping the reviewed/richest), concepts with no difficulty score
(set from the level), and active words with no forms (minted via the form
generator). Run it directly any time:

```
pnpm run doctor            # report integrity problems (exit 1 if any)
pnpm run doctor -- --fix   # repair in place, then mint missing forms
```

## The menu

| # | Item | What it does |
|---|------|--------------|
| 1 | Add common words for a level | the AI suggests CEFR words; you pick which to keep |
| 2 | Find a word | check if a word already exists before adding - typos & similar words are caught; shows the word's graph links |
| 3 | Browse words | list what is already in the lexicon - filter by level or text |
| 4 | Edit a word | hand-edit definitions, synonyms, antonyms, examples - tracked, no AI |
| 5 | Add one specific word | type a word (typos ok); the AI corrects & connects it |
| 6 | Grow from gaps | add words other entries point to but that are still missing |
| 7 | **Autopilot** | runs on its own: fills & publishes locally, chunk by chunk - pushing is opt-in |
| 8 | Review AI suggestions | approve or reject the items waiting for a human |
| 9 | Review word links | decide the queued links between words - one key per pair |
| 10 | Status report | what is done and what still needs work (incl. graph metrics + plural coverage) |
| 11 | Publish | build the packs + push to GitHub so consumers can pick them up |

**Find before you add:** item `2` is a read-only, offline lookup. It tells you
whether a word is already a headword, already present as a synonym/antonym, or
just similar (a likely typo or neighbour) - matching is typo-tolerant, so
`machne` still finds `machen`. If nothing exact turns up it offers to add it.

**Autopilot is the everyday driver:** pick `7`, press Enter, and it runs
unattended (auto-publish locally, ~20 words per chunk, resting the GPU between
them) until nothing is left to fill. Nothing is pushed to GitHub unless you
opt in: type `t` instead of Enter to change the pacing or enable per-chunk
pushing. Ctrl-C stops it; it resumes where it left off.

## Reviewing word links (menu item 9)

The automatic writer only links two words when BOTH sides assert the relation
and their CEFR levels are adjacent; everything else waits for a human in
`authoring/relation_queue.json`. Item `9` walks that queue one pair at a time
(the file regenerates itself when stale):

- each card shows both words (all languages), their levels, and the evidence
  (which side asserted the link, in which languages)
- one key decides: `s` synonym · `a` antonym · `r` related · `x` reject ·
  Enter skip · `q` quit & apply
- pairs whose levels are too far apart cannot be linked (the adjacency rule);
  the card says so - fix the concept level first, then the pair comes back
- on quit the decisions become `source: "manual"` edges in the source pack;
  the automatic writer never touches manual edges. Publish ships them.

The same decisions can be applied headless:
`node tools/scripts/apply_relation_queue.mjs --queue authoring/relation_queue.json --apply`
(edit the queue file adding `"decision"` fields first).

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

- The Autopilot publishes locally per chunk; content reaches GitHub only when
  you push (opt-in per chunk, or menu Publish). On the serving machine,
  `pnpm run refresh` pulls it for serving.
- Nothing risky ships unreviewed: drafted records are `needs_review`; only the
  clean, corroborated ones are auto-promoted (menu item 8 shows the rest).
