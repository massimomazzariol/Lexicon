# Lexicon Content Changelog

This file tracks multilingual lexical-content changes.

Use it for:

- new concepts
- semantic splits
- concept merges
- major lexical-family expansions
- concept-level editorial decisions worth preserving

Do not use this file for:

- package version bumps
- tooling changes
- CI or repository structure work
- generic release mechanics

Those belong in the root `CHANGELOG.md`.

The goal is to keep content history concept-first and language-neutral.
Entries should describe meanings and cross-language lexicalizations, not treat
one language as the owner of the change.

## 2026-07-16 - Graph review pass: 207 reviewed links join the concept graph

All 346 queued word-link pairs were reviewed: 207 became edges (synonym,
antonym, or related; source ai, reviewed one pair at a time), 48 were
rejected and remembered in relation_rejects.json (cross-part-of-speech
noise, English homonym artifacts, sibling terms that are not opposites),
and 91 stay pending (mostly wide-span pairs that need a level fix first).
The graph grows from 92 to 299 edges; isolated concepts drop to 49 percent.

Same day, second pass: the level-adjacency write rule was retired (ADR
0003 - relations span all levels, wide spans become an editorial advisory),
unklar moved from B2 to A2, and every remaining queued pair got its call:
the graph closes the day at 368 edges with an empty review queue (70
rejects remembered in relation_rejects.json).

## [Unreleased]

### Added / Updated Concepts

- MORPH-01 noun plural completion (2026-07-16): every active noun lexeme in
  de/it/en now carries either a plural form or an explicit mass marker.
  German: 54 curated plurals (incl. zero-change plurals like das Zimmer ->
  die Zimmer, now supported by the noun plugin for explicitly countable
  rows), 15 mass nouns, 2 missing genders fixed (Mama/Papa). Italian and
  English: 168 curated pl_core overrides, 14 uncountable senses marked mass
  (evidence, feedback, la portata in the Tragweite sense, consensus...).
  Curated data: tools/maintenance/noun_plural_completions.json.

- MT-C5 interconnection graph, Phase 1 + pilot (2026-07-15): the source now
  carries `concept_relations` edges (92: synonym / antonym, concept-level,
  undirected, max one CEFR level apart). 81 came from deterministic
  resolution of mutual flat synonym/antonym strings; 11 from the pilot batch
  (`entries.mt_c5_pilot_batch_01.json`), which promoted 11 dangling senses to
  full concepts across de/it/en: Wohnhaus/abitazione/dwelling (A1, the
  VBR-140C case), ignorieren/ignorare/to ignore (A2), unwichtig (A2),
  klar (A2), selten (A2), die Ablehnung/il rifiuto/rejection (B1),
  frisch (A1), gewoehnlich/solitamente/usually (B1), uebersehen (B1),
  zuletzt (B1), verlassen/lasciare/to leave (A2). Level note: Ablehnung was
  drafted A2 and moved to B1 - the new level-adjacency invariant flagged the
  mutual antonym pair with die Zusage (B2) as too far apart, and the flag was
  editorially correct. Known accepted collision: klar and deutlich share
  IT "chiaro" / EN "clear" (near-synonyms, now linked by a synonym edge;
  grading accepts both with tiers, ED-07 precedent).

- `überhaupt` split by function
  Scope:
  - negative-emphasis branch `überhaupt / at all / per niente`
  - broad/generalizing branch `überhaupt / in general / in generale`
  - emphatic-question branch
    `überhaupt / even (in emphatic questions) / poi (in domande enfatiche)`
  Languages: `de`, `en`, `it`
  Note: the old mixed entry was carrying at least three uses inside one concept.
  The negative branch now keeps `per niente` as the canonical Italian label,
  with `affatto` reduced to same-branch support instead of being the primary.

- `einfach` split by sense (2026-07-14)
  Scope:
  - adverb branch `einfach / simply / semplicemente`
  - travel-ticket branch `einfach / one-way / di sola andata`
  - plain-lifestyle branch `einfach / plain / sobrio`
  Languages: `de`, `en`, `it`
  Note: closes BUG-ED-04. The pre-existing concept kept its "easy/simple"
  sense; the three other senses of `einfach` now have their own concepts
  instead of being absent. A stale duplicate EN `just` lexeme left behind by
  a mid-fix re-upsert was marked `deprecated`/inactive to resolve a
  translation collision with `concept-b1-mal-softening`.

- `core answer-support wave 01`
  Scope:
  - English bare infinitive answer support for selected A1 core verbs such as
    `be`, `have`, `make`, `go`, `come`, `give`, `take`, `say`, `see`,
    `know`, `eat`, and `drink`
  - high-confidence lexical alternates for `Arzt`, `Auto`, and `Zug`
  Languages: `de`, `en`, `it`
  Note: this wave does not introduce new concepts. It adds approved
  same-concept answer surfaces where the editorial templates already treated
  them as acceptable, while keeping the fix conservative: verb bare forms are
  modeled as secondary active `exact` lexemes instead of `synonyms_json`, and
  only a small set of high-confidence noun/profession alternates was promoted
  in this first cleanup pass.

- `core answer-support wave 02`
  Scope:
  - additional English bare infinitive answer support for A1 core verbs such as
    `answer`, `work`, `bring`, `think`, `ask`, `hear`, `learn`, `read`,
    `open`, `close`, `write`, and `understand`
  Languages: `en`
  Note: this continues the conservative answer-support cleanup by promoting
  only the bare infinitive surfaces already implied by editorial templates,
  without promoting broader near-equivalents such as `reply`, `listen`,
  `study`, or `shut`.

- `core answer-support wave 03`
  Scope:
  - remaining English bare infinitive answer support for A1 core verbs such as
    `push`, `drive`, `fly`, `cook`, `love`, `sleep`, `sit`, `stand`,
    `fetch`, and `pull`
  Languages: `en`
  Note: this keeps the same narrow rule as the earlier waves: add only the
  bare form that matches the existing `to ...` lexeme, while leaving broader
  neighbors such as `press`, `ride`, `travel`, or `get` for later semantic
  review instead of silently widening grading.

- `core answer-support wave 04`
  Scope:
  - colloquial German A1 support for `öffnen -> aufmachen` and
    `schließen -> zumachen`
  - English A1 support for `to close -> to shut / shut`
  - very common everyday support variants `Bad -> das Badezimmer`,
    `qui -> qua`, and `lì -> là`
  Languages: `de`, `en`, `it`
  Note: this wave stays conservative but broadens grading where the variant is
  still the same concept in ordinary learner usage. It intentionally avoids
  more semantic shifts such as `study`, `reply`, or `walk`, which still need
  separate review instead of automatic promotion.

- `core answer-support wave 05`
  Scope:
  - family and everyday-register A1 support such as `Mutter -> Mama`,
    `Vater -> Papa`, `mother -> mom / mum`, `father -> dad`
  - common surface variants such as `allein -> alleine`,
    `insieme -> assieme`, `child -> the kid`, and
    `to be called -> to be named`
  Languages: `de`, `en`, `it`
  Note: this wave keeps the same rule as the earlier low-risk passes:
  only highly common, same-concept everyday variants were promoted. It still
  leaves out broader relational shifts such as `wife`, `husband`,
  `boyfriend`, or `girlfriend`, which would incorrectly widen the concepts for
  `Frau`, `Mann`, `Freund`, and `Freundin`.

- `core answer-support wave 06`
  Scope:
  - common A1 support for `anfangen -> beginnen / begin / cominciare`
  - everyday outdoor-location support such as `draußen -> im Freien /
    outdoors / all'aperto`
  - high-frequency adverb support such as `überall -> dappertutto`,
    `nie -> niemals`, `oft -> häufig / frequently`,
    `auch -> too / as well`, and `perhaps -> maybe`
  Languages: `de`, `en`, `it`
  Note: this wave stays within everyday same-concept variants and skips
  broader or more literary expansions such as `commence`, `loslegen`,
  `in every place`, or `sovente`, because the current priority is common
  learner-facing answer support rather than maximal synonym coverage.

- `core answer-support wave 07`
  Scope:
  - body and health support such as `stomach -> belly` and `sick -> ill`
  - time and togetherness support such as `mattino -> la mattina` and
    `zusammen -> gemeinsam`
  - compact high-frequency adverb support such as `nie -> niemals`,
    `oft -> häufig / frequently`, and `only -> just / soltanto / solamente`
  Languages: `de`, `en`, `it`
  Note: this wave again favors common learner-facing variants and avoids
  aliases that would widen the concept too much, such as `indisposto`,
  `serata`, or `giornata`, which are related but not cleanly interchangeable
  with the canonical A1 concepts.

- `core answer-support wave 08`
  Scope:
  - near-time and distance support such as `jetzt -> nun`,
    `nah -> nahe / close`, `schon -> bereits`, and `schnell -> rasch`
  - travel-place support such as `Bahnhof -> the station / station /
    la stazione dei treni` and `Straße -> la via`
  - state support such as `stare in piedi -> essere in piedi`
  Languages: `de`, `en`, `it`
  Note: this wave keeps favoring common learner surfaces that are still
  compatible with the same concept, while continuing to reject broader
  expansions like `the town`, `the road`, or `currently`, which would blur
  distinctions the lexicon is intentionally keeping separate.

- `comparison, gap, and resilience wave`
  Scope:
  - `gap or safe space / distanza / Abstand`
  - `difference / differenza / Unterschied`
  - `robust / robusto / robust`
  - `resilient under strain / resistente / belastbar`
  - `vulnerable / vulnerabile / verletzlich`
  Languages: `de`, `en`, `it`
  Note: this wave extends the existing comparison-distance family with
  `Abstand` and `Unterschied`, and adds a new B2 resilience-vulnerability
  cluster around `robust`, `belastbar`, and `verletzlich`. `Abstand` was kept
  separate from `Entfernung` by scoping it to gap or safe-space usage, and the
  data-evidence sense of `belastbar` was intentionally excluded to avoid
  overlap with `zuverlässig`.

- `creepy or unsettling atmosphere` addition
  Scope: `creepy / inquietante / gruselig`
  Languages: `de`, `en`, `it`
  Note: added from the German lemma `gruselig`. The concept is modeled around
  the broad unsettling or eerie atmosphere sense for places, stories, sounds,
  or situations. It was kept separate from a stronger gore-only or
  `terrifying` branch because those cross-language mappings are less stable.

- `advanced agreement and performance wave`
  Scope:
  - `to agree on / concordare / vereinbaren`
  - `binding / vincolante / verbindlich`
  - `negotiation / trattativa / Verhandlung`
  - `to negotiate / negoziare / verhandeln`
  - `to hammer out / pattuire / aushandeln`
  - `to accomplish / realizzare / leisten`
  - `to provide (formal result sense) / fornire / erbringen`
  - `high-performing / performante / leistungsfähig`
  - `capacity to perform / capacità di rendimento / Leistungsfähigkeit`
  - `outstanding / eccezionale / überragend`
  Languages: `de`, `en`, `it`
  Note: this wave expands two connected high-frequency families already present
  in the lexicon: agreement or negotiation language around
  `Vereinbarung`, and performance or output language around `Leistung`.
  `B2` runtime packs were regenerated; `C1/C2` entries now live in the source
  pack and are ready to accumulate toward fuller advanced runtime packs.

- `advanced reasoning, challenge, and misunderstanding wave`
  Scope:
  - `to require (as a precondition) / richiedere / voraussetzen`
  - `to entail / comportare / bedingen`
  - `to be connected / essere collegato / zusammenhängen`
  - `to follow the reasoning / seguire / nachvollziehen`
  - `understandable / comprensibile / nachvollziehbar`
  - `to challenge / sfidare / herausfordern`
  - `challenging / impegnativo / herausfordernd`
  - `misunderstanding / malinteso / Missverständnis`
  - `to misunderstand / fraintendere / missverstehen`
  - `to impress / colpire / beeindrucken`
  Languages: `de`, `en`, `it`
  Note: this wave expands several B1 families already present in the lexicon:
  `Voraussetzung`, `Zusammenhang`, `Vorgehen`, `Herausforderung`, and
  `Eindruck`. `B2` runtime packs were regenerated again; the new `C1` entries
  stay in the source pack until the advanced pack surface becomes substantial
  enough for dedicated higher-level runtime chunks.

- `advanced clarity, judgment, and context-setting wave`
  Scope:
  - `to clarify / chiarire / klarstellen`
  - `unambiguous / inequivocabile / eindeutig`
  - `open to misunderstanding / equivoco / missverständlich`
  - `to assess / valutare / einschätzen`
  - `assessment / valutazione / Einschätzung`
  - `convincing / convincente / überzeugend`
  - `responsible in conduct / responsabile / verantwortungsvoll`
  - `reliable / affidabile / zuverlässig`
  - `to put in context / inquadrare / einordnen`
  - `contextualization / contestualizzazione / Einordnung`
  Languages: `de`, `en`, `it`
  Note: this wave extends the communication and reasoning surface around
  `bewerten`, `überzeugen`, `Verantwortung`, `Zusammenhang`, and
  misunderstanding-related concepts. `B2` runtime packs were regenerated
  again; the new `C1` entries remain source-first until the advanced runtime
  layer is dense enough to justify separate higher-level chunks.

- `concept-b1-leistung`
  Scope: `performance / prestazione / Leistung`
  Languages: `de`, `en`, `it`
  Note: added from the plural request `Leistungen`, normalized to the lemma
  `Leistung`. This concept currently covers the `performance / shown level /
  output` sense only. The administrative or insurance-style `services /
  benefits` sense remains intentionally separate.

- `spitze` semantic tree
  Scope:
  - `pointed / appuntito / spitz`
  - `tip / punta / Spitze`
  - `lace / pizzo / Spitze`
  - `top position / vertice / Spitze`
  - `cutting / tagliente / spitz`
  - colloquial evaluative `great / fantastico / spitze!`
  Languages: `de`, `en`, `it`
  Note: the family is now split cleanly across physical shape, physical tip,
  textile lace, abstract top position, figurative biting tone, and the
  colloquial evaluative branch.

### Editorial Wave Backfill

- `time` disambiguation wave
  Scope:
  - `now / adesso / ora / jetzt`
  - `hour / ora / Stunde`
  - `clock or watch / orologio / Uhr`
  - `time of day / l'ora / Uhrzeit`
  Languages: `de`, `en`, `it`
  Note: this wave separated the ambiguous Italian `ora` family into distinct
  concepts and kept example-only clock-time expressions out of the concept
  model.

- `cleaning verbs` split
  Scope:
  - `wash / lavare / waschen`
  - `clean / pulire / putzen`
  - `clean (technical-formal) / pulire / reinigen`
  - `rinse / sciacquare / spulen`
  Languages: `de`, `en`, `it`
  Note: these were intentionally modeled as separate concepts instead of a
  single convenient `pulire` bucket.

- `compare and distance` additions
  Scope:
  - `comparison / confronto / Vergleich`
  - `distance / distanza / Entfernung` with accepted German variant `Distanz`
  Languages: `de`, `en`, `it`
  Note: these additions expanded the abstract comparison family and the spatial
  distance family while keeping near neighbors explicit.

- `sensitive` addition
  Scope: `sensitive / sensibile / empfindlich`
  Languages: `de`, `en`, `it`
  Note: added as a broad `easily affected` concept, not split into a separate
  emotional-only branch.

- `A1 answer support wave 09`
  Scope:
  - `correct / right / giusto / corretto / esatto / richtig`
  - `difficult / hard / schwierig / schwer`
  - `pharmacy / drug store / drugstore / chemist / Apotheke`
  - `medication / medicine / farmaco / medicinale / Medikament / Medizin`
  - `understand / capire / comprendere / verstehen`
  Languages: `de`, `en`, `it`
  Note: this wave keeps the grading cleanup conservative and only promotes
  support forms that stay close to the same everyday learner-facing concept.

- `A1 answer support wave 10`
  Scope:
  - `big / large / groß / grande`
  - `also / too / anche / pure / auch`
  - `ill / sick / malato / ammalato / krank`
  - `medication / medicine / Medikament / farmaco`
  - `healthy / well / sano / in salute / gesund`
  Languages: `en`, `it`
  Note: this wave stays focused on common everyday support forms and leaves out
  broader or more register-sensitive alternatives.

- `A1 answer support wave 11`
  Scope:
  - `correct / korrekt / richtig`
  - `child / kid / bambino / bimbo / Kind`
  - `female doctor / doctor / Ärztin`
  Languages: `de`, `en`, `it`
  Note: this wave promotes only everyday support forms that stay tightly
  aligned with the same learner-facing concept.

- `A1 answer support wave 12`
  Scope:
  - `wrong / incorrect / falsch`
  - `notebook / exercise book / Heft`
  - school-role support such as `teacher / Lehrer` and
    `student / Schüler / alunno`
  - education-language support such as `domandare / chiedere` and
    `parola / vocabolo`
  Languages: `en`, `it`
  Note: this wave stays conservative and promotes only support forms that
  remain clearly inside the same A1 school-domain concept instead of widening
  toward nearby categories like `classroom`, `pupil`, or profession-specific
  titles.

- `A1 answer support wave 13`
  Scope:
  - `simple or easy / einfach / semplice`
  - support forms `leicht`, `easy`, and `facile`
  Languages: `de`, `en`, `it`
  Note: this closes the remaining school-domain residue for the A1
  `einfach` concept by accepting the high-frequency difficulty-reading forms
  already implied by the editorial template.

- `A1 template hygiene wave 01`
  Scope:
  - removed spouse-only aliases from generic `man / woman`
  - removed romantic-partner aliases from `friend`
  - removed broader travel/place aliases such as `town`, `road`, `clinic`
  - trimmed residual health and adverb aliases like `the drug`,
    `indisposto`, `altresì`
  Languages: `de`, `en`, `it`
  Note: this cleanup reduces false drift rows by deleting template aliases that
  should not be promoted into grading support.

- `A1 template hygiene wave 02`
  Scope:
  - removed broader place and action aliases such as `town`,
    `countryside`, `nation`, `tun`, and `do` from A1 core concepts
  - trimmed food or abstract aliases like `vegetable`, `pie`, `supper`,
    `schmackhaft`, `hence`, `pertanto`, `boil`, and `get`
  - cleaned school-domain aliases such as `classroom`, `pupil`,
    `maestro`, `professore`, `pencil`, `false`, `significant`,
    `magari`, `duro`, and `arduo`
  Languages: `de`, `en`, `it`
  Note: this pass makes the residual drift backlog more honest by removing
  template aliases that would otherwise over-broaden grading, while keeping
  only the school-domain forms promoted in answer-support wave 12.

- `B1 vocabulary wave 01 (2026-05-25)`
  Scope: 29 new B1 concepts
  - process and action: `vorschlagen`, `klären`, `umgehen`, `ansprechen`,
    `einsetzen`, `erwarten`
  - nouns: `die Fähigkeit`, `die Verbesserung`, `das Ziel`, `der Schritt`,
    `der Abschnitt`, `der Ablauf`, `die Ursache`, `die Wirkung`,
    `die Kritik`, `die Ausnahme`, `die Notiz`, `die Zusammenfassung`,
    `der Aufwand`, `die Rückmeldung`, `der Vorwurf`
  - connectives and adverbs: `insgesamt`, `regelmäßig`, `ausreichend`,
    `kaum`, `zunächst`, `zudem`, `immerhin`, `stattdessen`
  Languages: `de`, `en`, `it`
  Note: brings B1 to exactly 100 concepts. QA: 0 spoilers, 0 missing definitions.

- `B2 vocabulary wave 01 (2026-05-25)`
  Scope: 56 new B2 concepts across five thematic waves
  - impression/evaluation: `beeindruckend`, `überrascht`, `enttäuschend`,
    `enttäuscht`, `überraschend`, `Enttäuschung`, `bewundernswert`,
    `eindrucksvoll`
  - judgment/distinction: `relevant`, `wesentlich`, `bedeutsam`, `erheblich`,
    `objektiv`, `subjektiv`, `grundlegend`, `strittig`, `nennenswert`
  - clarity/ambiguity: `präzise`, `unklar`, `vage`, `ausdrücklich`,
    `zweideutig`, `konkret`, `abstrakt`, `offensichtlich`
  - commitment/negotiation: `Kompromiss`, `verpflichtend`, `zustimmen`,
    `widersprechen`, `bestätigen`, `Einigung`, `Bedingung`, `Zusage`,
    `Anforderung`, `Zugeständnis`
  - pressure/resilience: `Druck`, `Stress`, `belastend`, `überwältigt`,
    `widerstehen`, `Ausdauer`, `durchhalten`, `scheitern`, `belasten`,
    `Rückschlag`
  - additional: `nachweislich`, `vertretbar`, `abwägen`, `überprüfen`,
    `festlegen`, `vereinfachen`, `eindeutig`, `belegen`, `hervorheben`,
    `zusammenfassen`, `auswerten`
  Languages: `de`, `en`, `it`
  Note: brings B2 to 83 concepts. QA: 0 spoilers, 0 missing definitions.

- `C1 vocabulary wave 01 (2026-05-25)`
  Scope: 25 new C1 concepts across three thematic waves
  - reasoning/contextualization: `Folgerung`, `Einwand`, `Nachweis`,
    `Schlussfolgerung`, `belegen`, `widerlegen`, `ableiten`, `Prämisse`,
    `Hypothese`, `herleiten`
  - formal assessment: `beurteilen`, `plausibel`, `fundiert`, `stichhaltig`,
    `Kriterium`, `Maßstab`, `Beurteilung`
  - structure/relevance: `zentral`, `maßgeblich`, `konsequent`,
    `systematisch`, `strukturiert`
  - additional: `differenzieren`, `verknüpfen`, `implizieren`
  Languages: `de`, `en`, `it`
  Note: brings C1 to 35 concepts (target was 25+). QA: 0 spoilers.

- `C2 vocabulary wave 01 (2026-05-25)`
  Scope: 7 new C2 concepts - selective high-register additions
  - `unerschütterlich` (unwavering), `bahnbrechend` (groundbreaking),
    `tiefgreifend` (far-reaching), `wegweisend` (pioneering),
    `nuanciert` (nuanced), `ambivalent` (ambivalent),
    `prädominant` (predominant)
  Languages: `de`, `en`, `it`
  Note: brings C2 to 8 concepts, within the 8-12 target range.

