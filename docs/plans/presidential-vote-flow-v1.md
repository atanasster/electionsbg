# Presidential vote flow — parliamentary list → presidential ticket

**Status:** in progress (2026-09-08)
**Asked for:** „the flow of votes Party → Presidential (ie 60% of ДБ voted for Радев first
round and 80% voted for him in second round)". Same-day parliamentary ballot for 2021; the
latest parliamentary vote before the cycle otherwise; tickets cut at >1% so the Sankey does
not overflow.

## 1. What already exists, and what this reuses

Three vote-flow pipelines are in the repo and all three share an estimator and a serializer:

| root | from → to | reconcile |
| ---- | --------- | --------- |
| `data/transitions` | parliamentary → parliamentary | `reconcile.ts` |
| `data/transitions_local` | council → council | `reconcile_local.ts` |
| `data/transitions_prevote` | parliamentary → council | `reconcile_parl_local.ts` |

Everything downstream of the reconcile is generic over `ReconcileResult`: `estimateOblast`
(NNLS + RAS) and `buildVoteFlowScopeFiles`. So this adds **one reconcile and one pipeline**
and reuses the rest verbatim — the same argument `reconcile_parl_local.ts` was written on.

New root: `data/transitions_presidential/<parlDate>_<cycle>_tur<round>/…`.

## 2. Which parliamentary election feeds which cycle

The latest parliamentary vote *at or before* the presidential round-1 date:

| presidential | from | note |
| ------------ | ---- | ---- |
| `2001_11_11_pvr` | — | 2001_06_17 is not in the corpus; no flow |
| `2006_10_22_pvr` | `2005_06_25` | REFUSED — see §3 |
| `2011_10_23_pvr` | `2009_07_05` | |
| `2016_11_06_pvr` | `2014_10_05` | |
| `2021_11_14_pvr` | `2021_11_14` | the SAME DAY |

⚠ 2021's „from" is the same-day ballot, so the pair is `at or before`, not `strictly
before` — the opposite of `parliamentaryBefore()` in `parl_local_index.ts`, where a
same-day parliamentary election cannot happen.

⚠⚠ **THE 2021 PAGE THEN CARRIES TWO ANSWERS ABOUT ONE PAIR OF BALLOTS, AND THEY ARE
DIFFERENT KINDS OF ANSWER.** „Едната бюлетина срещу другата" (`split_ticket.json`) is a
LOWER BOUND that assumes nothing — |A △ B| ≥ ||A| − |B|| per section. This is an ECOLOGICAL
REGRESSION, i.e. an estimate. They must not read as two attempts at the same number: the
flow says „движение, съвместимо с данните", the split-ticket says „поне". Both already carry
that wording; the risk is a reader meeting them one after another, so they stay in separate
sections with their own headings.

## 3. The section join, measured

The estimator regresses per section inside an oblast, so the two elections' sections must be
matched. Measured over the whole corpus (2026-09-08), share of the PRESIDENTIAL sections that
find a parliamentary twin:

| pair | full 9-digit code | (obshtina, last-7) | cascade |
| ---- | ----------------- | ------------------ | ------- |
| 2005_06_25 → 2006 | 66.1% | 54.6% | **66.1%** |
| 2009_07_05 → 2011 | 54.6% | 86.8% | **87.3%** |
| 2014_10_05 → 2016 | 97.4% | 85.5% | **97.4%** |
| 2021_11_14 → 2021 | 100.0% | 87.2% | **100.0%** |

Neither key wins everywhere — the МИР prefix scheme moved between 2009 and 2011 — so the
join is a CASCADE: full code first, then (obshtina, last-7). `(ekatte, last-3)` was measured
too and is worse everywhere AND carries duplicate keys (99–356), so it is not used.

**A coverage FLOOR of 80% refuses 2006 and admits the rest.** Any floor in (66.1, 87.3]
separates the measured cases; 80% sits near the middle of that gap so a future cycle drifting
a few points does not flip. The reason to refuse rather than publish with a caveat: the
dropped third is not random — whole municipalities were renumbered — so the regression is run
on a biased subset, and the tile would look identical to the good ones. `sectionsMatched` /
`sectionsDropped` are published either way, as the other three pipelines already do.

## 4. Lanes

**From (parliamentary):** canonical party lanes ≥1% of the parliamentary vote, else
`__parl_other`; `__abstain`; `__joined` where the rolls grew. Identical to
`reconcile_parl_local.ts`.

**To (presidential):** one lane per TICKET taking ≥1% of the round's valid votes, id
`pvr-<ballot number>`, labelled with the president's name and the ticket's own colour from
`tickets.json`. Below the cut → `__pvr_other`. Plus:

- ⚠⚠ **`__pvr_none` — „не подкрепям никого", ITS OWN LANE.** It is a real option on the
  presidential ballot from 2016 and it is NOT in `votes[]` — it lives in the protocol
  (`numValidNoOnePaperVotes` + `numValidNoOneMachineVotes`). Folded into abstain it would
  claim those people stayed home, when they turned out and chose nobody; dropped, the column
  mass would not balance and RAS would smear the difference across every ticket. Absent
  before 2016, so the lane appears only where the ballot had the option.
- `__abstain`, `__exited` — as everywhere else.

The 1% cut is the user's, and it is a READABILITY cut: a presidential ballot has no legal
threshold and 2021 had 23 tickets.

## 5. Scope

National + per-oblast, from the same estimator pass, keyed by the PRESIDENTIAL shard name
(`PDV`, `PDV-00`, `S23`…) so the files line up with `/presidential/:cycle/region/:oblast`.
`_unplaced` is excluded — „nowhere" is not a geography, the rule `build_runoff_transfer.ts`
already follows.

## 6. Surface

A tile in the presidential cycle page's own section, per round (the round is already a
toggle, so the flow follows `shown.round`). Reuses `VoteFlowTile`'s Sankey rather than
drawing a second one.

## 7. Gates

- The producer's own coverage floor, exercised both ways.
- „не подкрепям никого" reaches its lane and is not in abstain, on a cycle that has it (2016,
  2021) and is absent on one that does not (2011).
- The cascade join beats either key alone on the pair where they disagree (2011).
- Column mass balances: every ticket lane's total equals the round's published figure for
  that ticket, over the matched sections.
