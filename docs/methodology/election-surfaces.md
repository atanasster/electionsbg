# Election surfaces — methodology & editorial gate

This is the published methodology for the **election result surface**: the shared first screen
every election page renders — a scope bar, a place digest, up to four outcome facts, a map paired
with a ranked result, and up to three "what stands out" findings.

Implementation plan: [`docs/plans/elections-hub-implementation-v1.md`](../plans/elections-hub-implementation-v1.md).
The contract is `src/data/elections/surfaceTypes.ts`; the composition matrix is
`src/screens/elections/electionSurfaceDescriptors.ts`; and **§5's thresholds have an executable
copy in `src/data/elections/standoutThresholds.ts`**, which `standoutThresholds.test.ts` holds
against this document.

Because the standouts name places and, at local level, individuals, this page is the **gate**: a
signal must not ship in a form that contradicts it. Two rules govern every number below.

- **A statistical signal is a review lead, never evidence of wrongdoing.** Copy says "stands
  out", "differs from", "flagged for review". Never "fraud", "manipulation", or any causal
  claim.
- **A threshold change requires an edit to this file and a fixture update in the same commit.**
  `standouts.ts` imports its constants from a module whose header points here, which is the
  cheapest way to keep the two from drifting.

---

## 1. Result status

Five values, and each answers "how final is this?".

| value              | meaning                                                         |
| ------------------ | --------------------------------------------------------------- |
| `projection`       | modelled, not counted                                           |
| `provisional`      | counted, not certified                                          |
| `final`            | certified by the CEC                                            |
| `runoff_pending`   | a second round is scheduled and the office is not yet decided   |
| `partial_election` | an extraordinary (частичен / нов) election, not a regular cycle |

Every standout carries the status of the result it was computed from, so a finding drawn from a
provisional count can never be read as a settled one.

---

## 2. Turnout bases — and when we publish no rate at all

Turnout is a share, and the surface always names what it is a share **of**.

| basis                 | meaning                                                       |
| --------------------- | ------------------------------------------------------------- |
| `registered_voters`   | the СИК protocol's registered-voter count — the normal case   |
| `eligible_population` | a population denominator, where the register is not the basis |
| `unavailable`         | **no valid denominator exists; no rate is published**         |

⚠️ **Abroad publishes votes cast and no turnout percentage.** Voters abroad register at the
booth, so the registered-voter count is not a denominator — turnout computed against it reads
above 100%. The site already suppressed this card for МИР 32 before the surface existed
(`RegionDashboardCards`, `isDiasporaRegion`); the contract now makes the suppression structural:
`turnoutPct` is unreachable in the type when the basis is `unavailable`, so a generator cannot
emit "0% turnout" for a place whose turnout is simply not computable.

**An absent rate is not a zero, and is never rendered as one.**

---

## 3. Fact priority

Each kind × level declares an ordered list of fact codes; the strip renders the first four the
surface can actually fill. The list is composition, not content — the numbers come from the
canonical result files.

The full set: `winner`, `margin`, `seats`, `majority_threshold`, `turnout`, `valid_votes`,
`votes_cast`, `runoff_pending`, `split_control`, `wasted_vote`, `top_gainer`, `top_loser`,
`paper_machine`.

**What changed against the cards the site renders today**, measured 2026-09-02 across the five
parliamentary card screens (region and abroad share one screen):

| code            | decision                                                                                                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `top_gainer`    | **retained** at region, municipality, settlement and section; dropped at country and abroad, where winner+margin answer the level's own question better                                                                      |
| `turnout`       | **retained** at every level except abroad (§2)                                                                                                                                                                               |
| `paper_machine` | **retained** at every parliamentary level                                                                                                                                                                                    |
| `top_loser`     | **dropped everywhere.** The strip has four slots and this is the only card answering no question a reader asked — "who fell most" is the mirror of a fact already shown. Still reachable in the deeper party-change section. |

Added by the surface: `winner` and `margin` at every level; `votes_cast`/`valid_votes` at abroad
and section; `wasted_vote` and `seats` at country; and the whole local set —
`seats`, `majority_threshold`, `split_control`, `runoff_pending` — which had no cards at all.

---

## 4. Standout categories

At most three findings, at most one per category, in this priority order.

1. **outcome / change** — winner margin, lead change, threshold or majority crossed, split
   control, runoff pending.
2. **participation / competition** — turnout departure where the denominator is valid, an
   unusually close contest, an unusually fragmented council.
3. **review** — only a documented existing review signal, with a direct evidence destination.

Rules that apply to all three:

- a standout is **not emitted** when its denominator, baseline, or evidence destination is
  missing;
- the evidence route must be able to **name the rows** behind the claim;
- **a signal that is true of most places is a description, not a finding** — see §5.3;
- ties break on metric, then sample size, then a stable place id, so the same corpus always
  yields the same three;
- **Benford is not a standout signal in v1.** `ElectionStandoutSignal` has no member for it, so
  the surface cannot carry one at all. Its thresholds are recorded in §5.5 because the review
  destination a standout links to renders them — not because a Benford standout may be emitted.

---

## 5. The thresholds

Measured against the corpus on 2026-09-02. **Two of the four are not absolute numbers, and that
is the finding rather than a hedge** — the distributions move so much between cycles that a fixed
value would mean two different things depending on the year.

### 5.1 Close contest — a percentile, not a margin

| field                | value                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| **value**            | winner-to-runner-up margin in the bottom **5%** of that cycle's distribution, at that level            |
| **basis**            | per-cycle 5th percentile across eight cycles: 0.47 · 0.66 · 0.66 · 0.95 · 1.02 · 1.12 · 2.50 · 4.88 pp |
| **minimum sample**   | 200 valid votes — excludes exactly 1 of 305 places in 2026, an abroad micro-station                    |
| **what it excludes** | it always selects ~5%, so it can never report "nothing was close this cycle"                           |

A fixed 5 pp would select **5.3% of municipalities in 2026 and 24.3% in 2022_10_02**. The eight
measured percentiles top out at 4.88 pp, so the worst case the rule ever calls "close" is a
4.88-point margin — which is why it needs no absolute ceiling on top.

### 5.2 Turnout departure — against the national change, domestic only

| field                | value                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **value**            | the place's turnout change **minus the national change** over the same pair, in the top **5%** of that residual's distribution |
| **basis**            | residual p95 ran 4.89 → 12.81 pp across four consecutive pairs — still too wide for a fixed number                             |
| **minimum sample**   | 500 registered voters                                                                                                          |
| **what it excludes** | abroad entirely; and it cannot report a departure in a cycle where the whole country moved together                            |

A raw local change is not a finding when the country moved with it: between 2026 and 2024_10 the
**national** turnout change was 12.05 pp, so an 11-point local swing was the country, not the place.

⚠️ **Abroad is excluded, and that is §2 applied rather than a new rule.** It is also the entire
contaminated tail: the two abroad rows are **523.4 pp and 149.5 pp**, while all 298 domestic rows
are **≤ 22.0 pp**.

### 5.3 Fragmented council — and the sibling that is barred

| field                | value                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------- |
| **value**            | **≥ 9 parties** holding seats                                                            |
| **basis**            | across 289 councils in 2023: p50 = 4, p90 = 8, p95 = 9, max = 16 — so ≥ 9 is the top ~5% |
| **minimum sample**   | a council with at least 5 seats                                                          |
| **what it excludes** | councils whose fragmentation is ordinary for the cycle                                   |

⚠️ **"No single party holds a majority" must never be emitted.** 110 of 289 councils (38%) have
a majority, so **179 (62%) do not** — the absence of a majority is the ordinary case, and a
signal firing on most places is a description.

**Split control survives the same test and stays**: the mayor's party differs from the council
lead in **32 of 245 municipalities (13.1%)**.

⚠️ **That denominator is 245, not 289, and the difference is a definition rather than a gap.**
The 245 are the municipalities whose elected mayor carries a canonical party id, i.e. where a
party-to-party comparison is possible at all. Counting every elected mayor — treating an
independent or unmapped one as a split — gives **58 of 289 (20.1%)**. Both are true; the first
is the honest denominator for a claim about _party_ control, and it is the one this threshold
uses.

### 5.4 Section-derived signals — a floor of five

| field                | value                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| **value**            | the place must have **≥ 5 polling sections**                                                   |
| **basis**            | 315 of 353 places (89.2%) clear it, and they carry **99.5% of all sections**                   |
| **what it excludes** | places where "this section differs from the rest" would compare against fewer than four others |

### 5.5 Review signals — inherited, never chosen

These already exist and are already published. **The generator reads them from the producer; it
does not restate them** — a second copy is a second definition of a flag the reports publish.

| signal                          | threshold                          | source                                                            |
| ------------------------------- | ---------------------------------- | ----------------------------------------------------------------- |
| concentrated support            | `concentratedPct` = 80             | `data/<cycle>/dashboard/suspicious_settlements.json`              |
| invalid ballots                 | `invalidBallotsPct` = 10           | the same file                                                     |
| additional voters               | `additionalVotersPct` = 10, min 50 | the same file                                                     |
| Benford (not a signal — see §4) | `minVotes1BL` / `minVotes2BL` = 10 | `scripts/reports/benford.ts`, published to `reports/benford.json` |

---

## 6. The rule for any threshold added later

Both traps below fired during the first pass, and neither is visible without the measurement:

1. **Measure the statistic across every cycle before fixing a number.** An absolute margin would
   have meant two different things per cycle — 5.3% of municipalities in one, 24.3% in another.
2. **Check the signal is not true of most places.** A council-majority signal would have
   described 62% of the corpus.

A threshold is recorded here with four fields — value, basis, minimum sample, and what it
excludes — because a bare number is not reviewable. The thresholds are also exposed in each
page's source panel: a reader cannot judge "stands out" without them.
