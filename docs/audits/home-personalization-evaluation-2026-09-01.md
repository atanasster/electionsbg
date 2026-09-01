# Home dashboard — is event-level personalization ready?

**Date:** 2026-09-01 · **Verdict: NO-GO, with two named preconditions** ·
**Plan:** [`docs/plans/home-dashboard-implementation-v1.md`](../plans/home-dashboard-implementation-v1.md) Phase 7 / §7.4

§7.4 defers the watch-cursor schema until „the home feed event IDs survive a 30-day stability
test across rebuilds and backfills". This is that test, plus the subject-supply measurement the
schema would rest on. Both are reproducible:

```bash
npm run home:id-stability -- --days 35   # replay over real git history
npm run home:subjects                    # what a watchlist could key on
```

---

## 1. ID stability — the test §7.4 names

**Method: a REPLAY over real history, not a simulation.** The adapters are pure functions of
committed files, so `git archive` at a past commit reconstructs what the generator would have
produced that day. A synthetic „imagine a new row arrives" test measures the perturbation somebody
imagined; the defects below are shapes nobody would have thought to simulate.

⚠️ **TWO BASES, AND ONLY ONE OF THEM CAN CARRY A VERDICT.** The adapters emit everything they can
see — council resolutions back to 2024 — while the feed publishes a 30-day slice. A mutation on a
row eleven months out of window is real corpus instability and **cannot have been delivered to
anybody**. The first version of this document quoted the adapter-output column throughout and
overstated the finding by roughly 3×; the tool now prints both, and the in-window column is the
one below.

**27 checkpoints, 2026-08-02 → 2026-09-01, 26 transitions.**

| metric | adapter output | **in the published window** | what it means for a cursor |
| --- | --- | --- | --- |
| appeared | 1,524 | **144** | a genuinely new fact — the thing a subscriber wants |
| aged out | 374 | — | the window moving, not instability |
| vanished (in-window) | — | **7** | a row left while still publishable |
| **churned** (same fact, new id) | **0** | **0** | ✅ nobody is re-notified about what they already read |
| **mutated** (same id, new fact) | 10 | **3** | ⚠️ a cursor marks the NEW fact as already seen — silently |

### 1a. Churn is zero, and that is the half the design got right

Over 26 transitions and 1,524 new events, **not one** id changed while its fact stayed the same —
on a dated identity *and* on a date-free one. The construction rules hold: an id is minted from
the source's own identity (a sitting day, a resolution id, a УНП, a product slug, a period) and
never from ingestion time.

⚠️ **BUT THE ONE FAMILY THAT MOST NEEDED MEASURING WAS NOT MEASURED, and an earlier draft of this
document claimed otherwise.** The `prices` arm is the only one whose ids were ever derived rather
than quoted — a promotion's walk-back start day, removed in Phase 5 — and
`data/home/price_events.json` did not exist until 2026-09-01, the **last** checkpoint. So prices
is present at **1 of 27 checkpoints and takes part in 0 of 26 transitions**. Its clean score is
not evidence of anything, and the sentence „this replay is the evidence that the removal was
sufficient" was unsupported. The tool now prints per-family participation and flags any family
under two checkpoints, so it cannot be read the wrong way again.

`macro` is thin for a different reason — one event in the corpus, and it mutated once (§1b).

**What the zero DOES support:** churn is absent across `council` (27/27 checkpoints), `parliament`
(27/27), `opencalls` (21/27), `budget`, `debt` and `elections`. Six families over a month of real
movement, including two bulk ingests. It is the price arm specifically that is unproven, and one
more month of history settles it with no new work.

### 1b. Mutation is not zero, and it is the finding

Ten events kept their id while their content changed; **three of them were publishable at the
time**. All are **upstream corrections or a designed revision**, not id-construction defects —
which is precisely why the cursor schema cannot ignore them:

- **`macro:cpi_release:prc_hicp_minr:2026-07`**, mutated 2026-08-20. Eurostat re-published the
  July figure; the id keys on the PERIOD, so a revision updates the row rather than minting a
  second „July inflation". ⚠️ **This is the strongest evidence in the document, not the weakest.**
  It is by design, it is in-window, it is national — every subscriber would have it — and the
  number itself changed. An earlier draft dismissed it as „BY DESIGN" and leaned on a council
  example instead; that was the wrong way round.
- **`council:resolution:RAZ26-2026-prot36-r525` and `…-r526`**, both dated 2026-07-28 and mutated
  on 2026-08-18 by commit `ffb54d592e` — „Разград published 131 decisions that were not its own,
  and a 0-0-0 tally on almost every one that was". Same id, corrected content.
- The other **seven** were out of window when they changed. Real instability, but nothing could
  have been delivered about them, so they carry no weight here. The first version of this document
  illustrated the finding with one of them — `RAZ26-2025-prot26-r364`, dated **2025-09-30**,
  eleven months unpublishable on the day it mutated — and so described a delivery that could not
  have occurred.

⚠️ **A `{ subjectKey, lastSeenEventId, lastSeenAt }` cursor cannot survive any of the three.**
Once the reader has seen `macro:cpi_release:prc_hicp_minr:2026-07`, the revised figure is filtered
out as already read. The failure is silent, and it lands on the case where being told matters
most. Three in 26 transitions is not a rate to design away; it is a rate the schema has to
tolerate.

**Precondition 1: the cursor must store a CONTENT HASH beside the id**, and a changed hash under a
seen id must re-notify. That is a schema change to §7.4, not an implementation detail:

```ts
type WatchCursor = {
  subjectKey: string;
  lastSeenEventId: string;
  lastSeenFactHash: string;   // ⚠️ without this, an upstream correction is never delivered
  lastSeenAt: string;
};
```

---

## 2. Subject supply — what a watchlist could actually key on

Measured on the committed 28-event window to 2026-09-01. Attribution is derived from what each
event **declares** (`scope`, `route`, `factArgs`) and never from parsing its prose: a subject
guessed out of a title is a subscription that fires on a coincidence of words, and the reader
cannot tell which of the two it was.

| §7.4 subject kind | distinct subjects | events | verdict |
| --- | --- | --- | --- |
| `place` | **2** | 12 | ⚠️ 2 municipalities of 265 — `obshtina:PDV22` 11, `obshtina:RAZ26` 1 |
| `product` | 3 | 3 | thin but real |
| `programme` | 5 | 6 | ⚠️ keyed on a free-text NAME — see below |
| `company` | **0** | 0 | ❌ measured: no event family produces one |
| `institution` | **0** | 0 | ❌ measured: no event family produces one |
| `sector` | — | — | ⚠️ **NOT MEASURED — no extraction rule exists**, see below |

⚠️ **THE COUNCIL SHARD KEY IS NOT A MUNICIPALITY CODE, and the first version of this measurement
published the wrong place.** Eight of the sixteen council keys are not frontend codes and three
are OTHER municipalities': `PDV01` is **Асеновград**, `BGS01` is **Айтос**, `VAR01` is **Аврен**,
`SOF` names nothing. Lifted straight into a subject the key does not fail to resolve — it names a
different município, plausibly, and the reader cannot tell. Eleven of the twelve place
attributions were `PDV01`, so Plovdiv's decisions would have been delivered to subscribers in
Asenovgrad. `subjectsOf` now resolves through `obshtinaForCouncilKey` and **refuses** an
unresolvable key rather than naming a place, and `run()` reports the refusals so „we could not key
this" can never render as „this place has nothing".

⚠️ **`sector`'s zero is NOT a measurement.** No extraction rule exists for it — nothing an event
declares names a sector — so „0 events" would read as a measured absence. The tool prints
`NOT MEASURED` for it, which matters precisely when Precondition 2 is re-checked against a corpus
that has since grown one.

**21 of 28 events (75%) attach to at least one subject.** The seven that do not are national by
nature — a parliamentary sitting, a basket move, a debt auction — and attaching them to a subject
so that every watchlist has something to show would make the subscription meaningless.

Three consequences, in order of weight:

- ⚠️ **Three of six declared kinds have NO event supply, and a fourth was never measured.**
  `company` and `institution` are measured zeros; `sector` has no rule at all. Shipping a picker
  offering six kinds of which three can never fire is worse than shipping none.
- ⚠️ **A place watchlist is silent for 263 of 265 municipalities**, because only sixteen councils
  are ingested and only a couple filed inside the window. „No decisions near you" would be read as
  „your council decided nothing" — the exact misreading `home_coverage_council_partial` exists to
  prevent, delivered as a personalized non-event.
- **A programme subscription would key on a free-text name.** The open-calls corpus carries no
  programme id, so the register re-spelling a name silently ends the subscription.

**Precondition 2: at least one high-cardinality subject kind must have real event supply** before a
picker is worth building. The nearest candidates are `company` and `institution`, both of which
need a procurement event family the feed does not yet have (§6.2's procurement row is specified and
unimplemented).

---

## 3. Verdict

**NO-GO on §7.4's watch-cursor schema and on any accounts/delivery plan, on the evidence above.**
Not „not yet decided" — measured, with the two things that would change the answer named:

1. the cursor schema gains a content hash, because upstream corrections re-write facts under a
   stable id and the current shape delivers those as already-read;
2. one high-cardinality subject kind acquires event supply — realistically `company` or
   `institution`, via §6.2's unimplemented procurement adapter.

**What IS ready:** id churn is zero over 26 real transitions across six families, on two
independent identities. That is the property that would have been hardest to retrofit and the one
§7.4 was actually waiting on. The blockers are supply and schema, not identity — with the price
arm's own churn still unproven for want of history rather than for want of a fix.

**Not written, deliberately:** Phase 7 item 4 says „write a separate authorization/product plan …
**if justified**". It is not justified today, and writing one anyway would give a future reader a
plan whose premises this document contradicts.

---

## 4. Re-running this

Both tools are measurement-only — nothing imports them, and neither writes an artifact.

```bash
npm run home:id-stability -- --days 35          # human-readable; --days=35 also works
npm run home:id-stability -- --days 35 --json   # for a diff against this run
npm run home:subjects
```

⚠️ **`npm run home:id-stability` with no argument measures 30 days, not 35** — the figures above
are from `--days 35`, which reaches back to 2026-08-02. The `--since` window is counted from the
clock, so an identical command run later covers different commits and the checkpoint count moves.
Quote the run, not the default.

⚠️ The replay's checkpoints come from `git log` over the adapter sources, so a **shallow clone
makes it vacuous** — it reports „only 1 checkpoint, not measurable" rather than passing. Two more
things to read before trusting a future run:

- **the family-participation block.** A family present at fewer than two checkpoints took part in
  zero transitions and is flagged; its clean churn score is not evidence. That is how the price
  arm's absence was found.
- **the in-window column.** The adapter-output column is roughly an order of magnitude larger and
  cannot carry a verdict about delivery.

Re-run it before any future go/no-go: the in-window mutation count is the number that decides, and
it moves with how often the upstream scrapers correct themselves.

**Run provenance for the figures above:** `--days 35`, executed 2026-09-01 against the working
tree at `263d006ec3`; 27 checkpoints spanning 2026-08-02 … 2026-09-01.
