# Presidential (and local) analysis sections — v1

Bring the standard dashboard sections to `/presidential/*` — vote flow, geography,
anomalies, risky votes — and say which of them the local pages can have.

Everything below was MEASURED against the committed corpus on 2026-09-07, not inferred from
the parliamentary implementation. Two of the four requested sections are blocked; both
blockers are data, not effort, and both are stated with their evidence so nobody re-derives
them.

## 0. What the parliamentary dashboard has, and what each part needs

`DashboardCards` renders six sections. The four this plan is about:

| section | tiles | its input |
| --- | --- | --- |
| `votes` | `VoteFlowTile`, `HistoricalTrendsTile` | a transition model between two cycles |
| `geography` | `TopRegionsTile`, `DemographicCleavagesTile` | region roll-up + census by place |
| `anomalies` | `FlashMemoryTile`, `SuspiciousSectionsTile`, `RiskScoreTile`, `BenfordTile` | per-section protocols + a **flash-memory** reading |
| `neighborhoods` | `ProblemSectionsTile`, `ProblemVotesByPartyTile` | `problem_sections.json` + `problem_membership.json` |

## 1. What the presidential corpus actually carries

Per section (`<cycle>/tur<r>/sections/<oblast>.json`), measured on 2021 SFO:

```
code round placeName isMobile isShip machines
protocol{ totalActualVoters ballotsReceived numRegisteredVoters numAdditionalVoters
          numUnusedPaperBallots numInvalidAndDestroyedPaperBallots numMachineBallots
          numValidMachineVotes numValidNoOneMachineVotes numValidVotes
          numPaperBallotsFound numInvalidBallotsFound numValidNoOnePaperVotes }
votes[]{ partyNum paperVotes machineVotes totalVotes }
```

Cycle-level: `national_summary.json`, `tickets.json`, `runoff_transfer.json`,
`split_ticket.json`, plus the `surface/` tree.

⚠ It carries **no** `problem_sections.json`, `problem_membership.json`, `analysis_stats.json`
or `reports/` — the four files the parliamentary anomalies and neighbourhoods sections are
built from.

## 2. Feasibility, section by section

### 2.1 Поток на гласовете — PARTLY, and the parts are not equal

- **Round 1 → round 2, COUNTRY** — ✅ `runoff_transfer.json` exists and
  `PresidentialTransferTile` already renders it. Nothing to do.
- ⚠ **Round 1 → round 2, BELOW COUNTRY — PRODUCER WORK, NOT WIRING.** The file does carry a
  per-oblast arm, so a region flow looks like a small extension, and it is not: `national`
  carries a ready `matrix`, while each of the 31 `oblasts` rows carries the regression's
  COEFFICIENTS (`a1 a2 w1 w2 reg1 reg2 v1 v2 elim n1 n2 rasResidual`) and no matrix.
  Building one in the client would be a SECOND implementation of the ecological regression,
  which is how two surfaces come to publish different estimates of the same transition — the
  exact thing `basis` exists to prevent. The producer must emit the per-oblast matrix.
  Below oblast there is no arm at all, so município and settlement have no transfer data.
- **Round 1 candidates → round 2 finalists** — ✅ the same file. This IS the transfer.
- **Parliamentary parties → round 1** — ⚠ **2021 ONLY.** `split_ticket.json` can exist only
  where a parliamentary vote shared the day, and 2021 is the one cycle that did. The other
  four have no such file by construction, so this arm must self-hide rather than render an
  empty flow.
- ⚠ **A SANKEY IS THE WRONG FORM HERE AND THE NUMBER SAYS SO.** 2021 round 1 carried **23
  tickets**; the parliamentary flow draws ~11 nodes a side and is already dense. 23 → 2 is a
  chart whose ribbons cannot be traced. The requested "switch to a different display type"
  is therefore the DEFAULT for round 1, not a fallback: a ranked "where did each eliminated
  pair's vote go" table, with the Sankey reserved for the ≤4-node round-2 view.

### 2.2 Geography — YES

- **Top regions** — ✅ the region roll-up the country map already fetches. No new request.
- **Demographics** — ✅ portable. `DemographicCleavagesTile` correlates census traits against
  party share per município; the presidential municipality roll-up supplies the same shape
  keyed by ticket. ⚠ The tile's copy says „партия" throughout and must be re-worded per kind:
  a ticket is a PAIR of named people and its nominator may be an инициативен комитет.

### 2.2a ⚠ The municipality roll-up cannot carry the demographics, and the reason is София

§2.2 said the presidential municipality roll-up „supplies the same shape keyed by ticket". It
does not. Measured on 2021 round 1, `tur1/municipality_votes.json` holds **1,927,234 of
2,394,489 domestic ticket votes (80.5%) across 272 keys — and Sofia city is not among them**;
its largest municipality is Варна. That roll-up is built through the ЕКАТТЕ join, whose
catalogue has no row for София or the absorbed quarters. A correlation over it is not a partial
answer but a wrong one in exactly the education / religion / ethnicity dimensions the dot plot
draws, since София moves every one of those coefficients.

The route that works needs no catalogue at all: the SECTION code carries the municipality.
`234602001` is МИР 23, municipality 46 (Столична), rayon 02. Measured, that maps **265 of 265
census municipalities and every domestic ticket vote**, with the residue against the published
national total equal to `abroad.json`'s sum exactly. The `_unplaced` shard — 2011's 1,354
София sections, 441,328 votes — is recovered from its own (МИР + municipality) key, learned from
the placed shards of the same round; dropped, София would enter the correlation from its rural
rayons alone, i.e. **7% of its votes** plotted against the census profile of all of it.

### 2.3 Anomalies — SPLIT, and the headline item is blocked

- ✅ **Разлика с флаш паметта — DONE, and this section said it was blocked.**
  `presidentialCatalogue.ts` declares `flashRecords` per round, and measured across the five
  cycles exactly one has records at all:

  | cycle | flashRecords | machineVoting |
  | --- | --- | --- |
  | 2021_11_14 | **true** (both rounds) | true |
  | 2016_11_06 | false | true |
  | 2011 / 2006 / 2001 | false | false |

  What this section got wrong was the COST, not the coverage: it predicted „its own ingest
  tier", and the СУЕМГ trees were already on disk, so `build_flash_diff.ts` is a PROJECTION
  over them rather than a crawl. `flash.json` is written per round, is on `bucket_gzip.ts`'s
  publish list, and `PresidentialFlashMemoryTile` renders it.

  Still **2021 only, for ever** — and 2016 remains the case that shows `machineVoting` does not
  imply a comparison exists: machines counted votes in 500 of its round-1 sections and ЦИК
  published nothing from them, which is why the tile keys on the RECORDS rather than the flag.

- **Подозрителни населени места** — ✅ derivable. The protocols carry `numAdditionalVoters`,
  `numInvalidAndDestroyedPaperBallots` / `numInvalidBallotsFound` and per-ticket votes, which
  are the three inputs behind concentration, invalid-ballot and added-voter flags.
- **Benford** — ✅ derivable, and the cheapest companion to the item above. `BenfordTile` reads
  first-digit frequencies off per-section party votes; the presidential section shards carry
  `votes[].totalVotes` at the same grain, so it needs no new input at all. It is listed in §0
  and had no verdict here until 2026-09-07.
- **Скрининг на секции / risk score** — ✅ DONE, and it is NOT a port. See §2.5.

### 2.5 The screening, and the two signals of four it could not have

The parliamentary `risk_score` fuses four procedural signals with three vote-DISTRIBUTION ones,
and its own header records why the composite cannot answer a question about vote distribution:
ranking by it still tracks the distribution family, measured at 2.81x apparent concentration for
one party. `build_screening.ts` therefore takes `PROCEDURAL_SIGNALS` and stops — the screen
cannot rank a candidate's sections, because nothing it reads knows who won.

⚠⚠ **TWO OF THE FOUR PROCEDURAL SIGNALS ARE NOT COMPUTABLE HERE, AND THEY ARE NAMED ON THE
SURFACE.** `recount` needs a recount report no presidential protocol field in any of the five
cycles carries. `suemgMismatch` needs a PER-SECTION flash comparison; the projection behind
`flash.json` aggregates its per-section map away, and re-deriving it would read the СУЕМГ trees
— gitignored host state, 2021 only. Adding a signal present on one cycle and absent on four,
from an input a fresh clone does not have, is precisely what T4 had to refuse.

⚠⚠ **SO THE SCORE IS TWO SIGNALS, AND OFTEN ONE.** The invalid-ballot signal needs a PAPER
denominator, and 2021 counted on machines: at round 1 only **1,722 of 10,967** scored sections
carry both signals. `signalsAvailable` is on every row and the tile says so at round level,
because a one-signal score is that signal wearing a composite's grammar.

⚠⚠ **THE BANDS ARE THE SHARED ABSOLUTE CUTS AND THE PER-CYCLE RATE IS PUBLISHED BESIDE THEM** —
this plan's own established answer, from `build_suspicious.ts`. Share of SCORED sections above „low",
round 1, read back off the committed artifacts:

| 2001 | 2006 | 2011 | 2016 | 2021 |
| --- | --- | --- | --- | --- |
| 0.71 % | 2.36 % | **16.03 %** | 6.80 % | 9.72 % |

A fixed cut is what lets „повишено" mean one thing sitewide — `BAND_CUTS` and `CAPS` are
IMPORTED from `risk_score.ts`, which is why that file now exports its caps — but it also means
2011 puts a sixth of its scored sections above the bar, which is a statement about the year
rather than about 1,733 named stations. `discriminating` is false above 5%, and four of the ten rounds
(2011 r1, 2016 r1, 2021 both) name no sections at all.

⚠ **THE INVALID SIGNAL IS NOT DEMOGRAPHICALLY NEUTRAL** and the caveat says so in the artifact:
it correlates with Roma population share (r = +0.36 at municipality level), with documented
explanations such as ballot complexity. That is `risk_score.ts`'s own measurement, carried
rather than restated.

### 2.4 Рискови гласове / the Roma neighbourhoods — YES, via the section-code join ✅ MEASURED

⚠ The membership catalogue is a claim about a PLACE, not about an election, which is what
makes reusing it legitimate — the same argument that licenses the coordinate join. A
neighbourhood's sections do not change because a different ballot was counted in them.

**The four unmeasured cycles have now been measured, over the FULL corpus rather than a
sample** (2026-09-08). The join is by SECTION CODE only: presidential shards carry no `address`
at all (0 of 12,488 on 2021 r1), so the catalogue's `ekatte` + `addressIncludes` arm can never
fire, and Sofia's entries are keyed on a synthetic district ЕКАТТЕ (`68134-2511`) no shard
carries. What bridges them is `buildNeighborhoodSectionCodes`, which unions the codes those
address rules resolve to across every parliamentary election from 2022 on. Sections matched per
district, round 1:

| district | 2001 | 2006 | 2011 | 2016 | 2021 |
| --- | --- | --- | --- | --- | --- |
| stolipinovo | 70 | 70 | 70 | 70 | 70 |
| fakulteta | 10 | 10 | **0** | 11 | 11 |
| filipovci | 4 | 4 | 4 | 4 | 5 |
| nadezhda_sliven | 8 | 8 | **0** | 8 | 8 |
| pobeda_burgas | 8 | 8 | 8 | 8 | 8 |
| gorno_ezerovo | 3 | 3 | 3 | 3 | 3 |
| dolno_ezerovo | 7 | **0** | **0** | 7 | 7 |
| maksuda | 22 | 22 | 22 | 22 | 23 |
| **located (of 8)** | **8** | **7** | **5** | **8** | **8** |

⚠⚠ **COVERAGE IS NOT MONOTONIC IN TIME, so „older is worse" is the wrong prediction and the
weakest cycle is the MIDDLE one.** 2001 — twenty years older than the archive the codes are
resolved from — locates all eight, and 2011 locates five. That is section RENUMBERING, which
means a cycle here cannot be read against another cycle: the 2011 aggregate is a different set
of places. `coverage.located` / `coverage.missing` are on the artifact and the tile prints the
missing districts BY NAME.

⚠ **The `sectionSuffixes` rule was verified rather than assumed.** It matches the 9-digit code
minus its МИР prefix, which could in principle attach a station in another oblast to a Sofia
махала; measured across all five cycles, every suffix resolves to at most ONE section.

⚠⚠ **TWO DEFECTS SHIPPED DURING THE BUILD AND BOTH ARE NOW GATED.** Skipping the
placement-refused shard — correct in `build_suspicious.ts`, which aggregates by ЕКАТТЕ — cost
FOUR of 2011's eight districts, because that cycle's `_unplaced` holds 1,354 София sections. And
an unfloored invalid-ballot rate published „3.51% here against 2.93% nationally" for 2021 out of
**228 paper ballots** (78 in the runoff) — these districts voted almost entirely on machines,
and Столипиново's seventy stations report ZERO paper in both rounds. `INVALID_MIN_PAPER` is the
floor; the smallest genuine per-district denominator in any other cycle is 706.

The matched stations are **0.90–1.26% of the valid vote** in every round — a lens on eight named
districts, never a national statistic.

## 3. The local pages — what they need, and what they cannot have

`LocalCountryDashboardCards` already renders `local-maps`, `local-mayors`, `local-councils`,
`local-flows`, `local-trends`, `local-extraordinary`. So **flows and trends already exist**
and need no work.

⚠⚠ **AND SO DOES GEOGRAPHY — BOTH HALVES. This section said otherwise and was wrong.**
Verified in the running app on 2026-09-07, `/local/2023_10_29_mi`:

- **Top regions** — `LocalRegionsTable` renders as „Топ области" inside `local-maps`, with a
  „Виж детайли →" link to `/local/:cycle/regions`, beside two `LocalRegionsControlMapTile`
  choropleths (mayoral control, council support). ⚠ It ranks by MUNICÍPIO COUNT rather than by
  votes, and that is right rather than an omission: a local cycle is a set of races, not one
  national vote, so „where were the most votes" is not the question its oblast row answers.
- **Demographics** — `LocalDemographicCleavagesTile` renders TWICE, once in `local-mayors`
  (`race="mayor"`, the first-round mayoral vote) and once in `local-councils` (the proportional
  council vote). Both were already kind-aware: that component is a self-contained copy of the
  dot plot with a plain, unlinked legend, precisely because local parties are keyed by canonical
  id and carry no per-party page.

So the local half of T2 is CLOSED with no code change, and a „геогра́фия" section added here
would duplicate `local-maps` and both cleavages tiles under a third heading.

⚠⚠ **NEIGHBOURHOODS ARE NOT BLOCKED ON LOCAL — THEY ALREADY SHIP, and this section said the
opposite in the strongest terms it had.** That claim would have retired T4 for local
permanently, on evidence that is wrong in three separate ways. The truth, measured 2026-09-07:

- **The feature exists end to end.** `scripts/parsers_local/problem_sections_local.ts` imports
  the SHARED `PROBLEM_NEIGHBORHOODS` catalogue — i.e. it does borrow it — and matches it against
  local sections **by ЕКАТТЕ + address, deliberately NOT by section code**, which is precisely
  the resolution this section said did not exist; its own header says so. It is wired into
  `scripts/main.ts` behind `--local-coords` / `--local-problem-sections` / `--all`, the
  artifacts are committed (`data/2023_10_29_mi/problem_sections.json` and three siblings), and
  `LocalProblemVotesByPartyTile` renders inside a `local-risk-votes` section titled with the
  SAME `dashboard_section_neighborhoods` key the parliamentary one uses.
- **The code schemes PARTLY AGREE, and which archive you join against decides everything.**
  Local codes are NSI-oblast-prefixed and parliamentary ones МИР-prefixed, and those diverge
  from Пловдив onward — so corpus-wide **6,690 of 12,302 (54.4%)** of 2023 local codes ARE in
  the 2021 parliamentary archive, while SFO09's eleven are 0/11 because София is on the
  diverging side. This section took the worst case and stated it as the scheme. Against the
  **PRESIDENTIAL** tree they agree almost completely — **11,416/11,418 (99.98%)** for 2011,
  whose local and presidential ballots shared a day, and **11,367/12,302 (92.40%)** for 2023.
  That is the OPPOSITE of the conclusion drawn here, and it is the same join §2.4 licenses.
- **The zero coordinates are not a missing crosswalk.** The count is right — 0 of 289 município
  shards carry one — but `backfill_local_section_coords.ts` IS the crosswalk, is built around
  exactly this divergence (four strategies, every one gated on settlement-name agreement),
  claims ~97-99% coverage in its header and is wired to `--local-coords`. The open question is
  whether that pass still yields its documented coverage, which is cheap to answer; „no
  crosswalk exists" is not the finding.

What IS open on local, and is narrower than a blocker:

- the COUNTRY page (`LocalCountryDashboardCards`) carries no neighbourhoods section — the tile
  is per-município by construction;
- coverage has REGRESSED: **2 of the 9 curated neighbourhoods matched in 2023 and 2019, against
  7 in 2011 and 2015**. That is a matcher/address question, not a corpus one.

Geography/demographics on local is DONE (above), not merely feasible.

## 4. Tiers

- **T1 — vote flow on presidential.** ✅ DONE. The producer emits a per-oblast transfer shard
  (`<cycle>/runoff_transfer/<oblast>.json`) from the same `est.flows` the national matrix is
  summed from; `PresidentialTransferTable` replaces the Sankey above `SANKEY_MAX_FROM_NODES`
  (12), so 2011/2016/2021 get a ranked table and 2001/2006 keep the chart; and region pages
  mount the shard. The parties→round-1 arm needed no work — `PresidentialSplitTicketTile` was
  already gated on `split_ticket.json` being `ready`. Município and settlement get no transfer.

  ⚠ **AND THE TREE WAS 404 IN PRODUCTION.** `runoff_transfer.json` and `split_ticket.json` were
  never on `bucket_gzip.ts`'s list, which is the only thing that publishes the presidential
  tree — so both tiles had never rendered on the live site, silently, because a missing file is
  `absent` by design.
- **T2 — geography.** ✅ DONE. Presidential got both tiles (`PresidentialTopRegionsTile` from
  the region roll-up the map already fetches, and `PresidentialCleavagesTile` over a new
  per-round `demographic_cleavages.json` — see §2.2a above for why its producer reads the
  SECTION shards). **Local needed nothing**: both halves were already built — see §3.
- **T3 — suspicious settlements.** ✅ DONE. `build_suspicious.ts` writes a per-round
  `suspicious_settlements.json` at SETTLEMENT grain from the presidential protocols, and
  `PresidentialSuspiciousTile` renders it inside an „Аномалии" section beside the flash-memory
  tile. Every category carries its own `nationalPct` and `flaggedShare`, and `discriminating`
  is what stops a top-3 being drawn from a flag that separated nothing — 2011's invalid rule
  catches 35.5% of the country and 2006's runoff concentration rule 59.6%.
- **T4 — risky votes / neighbourhoods.** ✅ DONE. A per-round `neighborhoods.json` producer
  (`build_neighborhoods.ts`) joins the shared `PROBLEM_NEIGHBORHOODS` catalogue to the
  presidential sections by CODE, and `PresidentialNeighborhoodsTile` renders it under the same
  `dashboard_section_neighborhoods` key the parliamentary dashboard uses. Coverage, the
  districts that could NOT be located, and the sources that named each district are all on the
  surface — see §2.4 for the full-corpus measurement that replaced the 150-settlement sample.
- **T5 — section screening.** ✅ DONE, procedural signals only. `build_screening.ts` writes a
  per-round `section_screening.json` and `PresidentialScreeningTile` renders it inside the
  „Аномалии" section beside the flash-memory and suspicious-settlement tiles. The composite was
  NOT ported: only `PROCEDURAL_SIGNALS` is read, so the screen cannot rank a candidate's
  sections — see §2.5 for what that costs and what it buys.
- **T0 — Разлика с флаш паметта.** ✅ DONE, 2021 only and for ever. It needed a PROJECTION over
  the СУЕМГ trees already on disk, not the new ingest tier §2.3 predicted.

## 4a. What is wiring and what is not

Worth stating plainly, because the request reads as UI work and most of it is not:

| tier | client | producer / ingest | state |
| --- | --- | --- | --- |
| T1 vote flow | tile mounts, round-1 table form | per-oblast matrix | ✅ done |
| T2 geography | tiles, kind-aware copy | per-round cleavages | ✅ done |
| T3 suspicious settlements | tile | **a pass over the section protocols** | ✅ done |
| T4 risky votes | tile + the section-code join | **a per-round join over the section protocols** | ✅ done |
| T5 section screening | tile | **a procedural-only score** | ✅ done |
| flash memory | tile | a projection over the СУЕМГ trees on disk (operator-run), 2021 only | ✅ done |

⚠ **THREE OF THIS TABLE'S OWN PREDICTIONS WERE WRONG, and all three sat in the „no producer
needed" column.** T2 was listed as client-side because the roll-ups exist; the municipality one
cannot see София (§2.2a), so it needed a producer after all. „Flash memory" was listed as out of
scope needing an ingest that turned out to be a projection over the СУЕМГ trees already on disk.
And T4's „— (catalogue exists)" was wrong in the same way: the catalogue does exist, and the
presidential shards carry no `address` for it to match on, so the join needs the parliamentary
corpus walked at build time and a per-round artifact written from it. The lesson is now three
for three — „the data is already there" has never once meant „no producer needed".

## 5. The rule every tier inherits

A tile ported from the parliamentary dashboard says „партия" in its copy and resolves a
`partyId` for its colour and its link. A presidential row has neither: `partyId` is null by
design because the nominator may be a party, a coalition or an инициативен комитет, and the
row is a PERSON. Every ported tile needs its label resolved from `tickets.json` and its copy
re-worded, exactly as `ElectionResultsShell`'s `rowColor`/`rowHref` props already do for the
ranked list. A tile that renders correctly with the wrong noun is the failure mode here.
