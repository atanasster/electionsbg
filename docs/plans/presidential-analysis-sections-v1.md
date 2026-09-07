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

### 2.3 Anomalies — SPLIT, and the headline item is blocked

- ⚠⚠ **Разлика с флаш паметта is NOT derivable today.** `presidentialCatalogue.ts` already
  declares `flashRecords` per round and its own header says why it is special: „no
  presidential reader ingests the flash tree". Measured across the five cycles, exactly one
  has records at all:

  | cycle | flashRecords | machineVoting |
  | --- | --- | --- |
  | 2021_11_14 | **true** (both rounds) | true |
  | 2016_11_06 | false | true |
  | 2011 / 2006 / 2001 | false | false |

  So this tile is (a) impossible for four of five cycles for ever, and (b) blocked on a new
  ingest for the fifth. 2016 is the instructive case the catalogue names: machines counted
  votes and their records were never published, so „machine voting" does not imply a
  comparison is available. **Out of scope for v1**; it needs its own ingest tier.
- **Подозрителни населени места** — ✅ derivable. The protocols carry `numAdditionalVoters`,
  `numInvalidAndDestroyedPaperBallots` / `numInvalidBallotsFound` and per-ticket votes, which
  are the three inputs behind concentration, invalid-ballot and added-voter flags.
- **Скрининг на секции / risk score** — ⚠ possible but NOT a port. The parliamentary
  `risk_score` mixes procedural signals with vote-DISTRIBUTION ones, and this repo has a
  standing caveat that only the procedural half may be used for claims about a party. A
  presidential screening must be built from the procedural signals alone or restate that
  caveat; copying the composite would import a known defect.

### 2.4 Рискови гласове / the Roma neighbourhoods — YES, via the section-code join

`problem_sections.json` and `problem_membership.json` are keyed by the 9-digit CIK section
code, and the presidential tree uses that same scheme. Verified: the identical join carries
the settlement map's coordinates at **96.9–97.7%** across four parliamentary cycles.

⚠ The membership catalogue is a claim about a PLACE, not about an election, which is what
makes reusing it legitimate — the same argument that licenses the coordinate join. A
neighbourhood's sections do not change because a different ballot was counted in them. What
must still be stated on the surface is the ~3% of stations the join does not reach.

## 3. The local pages — what they need, and what they cannot have

`LocalCountryDashboardCards` already renders `local-maps`, `local-mayors`, `local-councils`,
`local-flows`, `local-trends`, `local-extraordinary`. So **flows and trends already exist**
and need no work.

⚠⚠ **ANOMALIES AND NEIGHBOURHOODS ARE BLOCKED ON LOCAL FOR A MEASURED REASON, and it is the
same one that blocked the município station map.** Local section codes are a DIFFERENT
numbering scheme from the parliamentary/presidential one: `230900001` and its ten siblings in
SFO09 appear **0 times** anywhere in a parliamentary archive sample, which is why
`backfill_local_section_coords.ts` has produced **0 coordinates across all 289 município
shards** — on disk and in the live bucket. Until a crosswalk exists, local cannot borrow the
neighbourhood catalogue, the coordinates, or anything else keyed on that code.

Geography/demographics IS feasible on local, on the same footing as presidential.

## 4. Tiers

- **T1 — vote flow on presidential.** ⚠ Starts in the PRODUCER: emit a per-oblast transfer
  matrix beside the national one. Then the tile on region pages, the parties→round-1 arm
  gated on `split_ticket.json` existing, and round 1 rendered as a ranked transfer table
  rather than a 23-node Sankey. Round 2 keeps the flow chart. Município and settlement get
  no transfer — there is no arm below oblast to give them.
- **T2 — geography.** Top regions + a kind-aware demographics tile, presidential and local.
- **T3 — suspicious settlements** from the presidential protocols.
- **T4 — risky votes / neighbourhoods** via the section-code join, with the unjoined share
  stated on the surface.
- **T5 — section screening**, procedural signals only.
- **Out of v1: Разлика с флаш паметта.** Needs a flash-tree ingest and can only ever cover
  2021.

## 4a. What is wiring and what is not

Worth stating plainly, because the request reads as UI work and most of it is not:

| tier | client | producer / ingest |
| --- | --- | --- |
| T1 vote flow | tile mounts, round-1 table form | **per-oblast matrix** |
| T2 geography | tiles, kind-aware copy | — (roll-ups exist) |
| T3 suspicious settlements | tile | **a pass over the section protocols** |
| T4 risky votes | tile + the section-code join | — (catalogue exists) |
| T5 section screening | tile | **a procedural-only score** |
| flash memory | tile | **a flash-tree ingest**, 2021 only |

T2 and T4 are the two that are client-side today.

## 5. The rule every tier inherits

A tile ported from the parliamentary dashboard says „партия" in its copy and resolves a
`partyId` for its colour and its link. A presidential row has neither: `partyId` is null by
design because the nominator may be a party, a coalition or an инициативен комитет, and the
row is a PERSON. Every ported tile needs its label resolved from `tickets.json` and its copy
re-worded, exactly as `ElectionResultsShell`'s `rowColor`/`rowHref` props already do for the
ranked list. A tile that renders correctly with the wrong noun is the failure mode here.
