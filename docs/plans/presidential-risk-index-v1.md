# Presidential Election Risk Index — v1

Status: shipped 2026-10-06.

## What it is

The parliamentary „Индекс на изборния риск" (`src/data/riskScore/computeRiskComposite.ts`) for a
presidential round, plus the section risk score that feeds it. Rendered first in the „Аномалии"
section of `/presidential/:cycle` by `PresidentialRiskIndex`: the shared composite ribbon
(`CompositeIndexRibbonView`, now also behind the parliamentary ribbon) and a „Рискови секции" card.

## Pieces

| Piece | File |
| --- | --- |
| Section score producer → `data/<cycle>/tur<r>/risk_score.json` | `scripts/parsers_presidential/build_risk_score.ts` (in the `--pvr` ingest beside the screening writer) |
| Corpus gate | `scripts/parsers_presidential/risk_score.data.test.ts` |
| Guarded fetch | `src/data/presidential/useRiskScore.ts` |
| Composite (pure) + tests | `src/data/presidential/presidentialRiskComposite.ts` |
| React adapter | `src/data/presidential/usePresidentialRiskComposite.ts` |
| UI | `src/screens/presidential/PresidentialRiskIndex.tsx` |

## Section score

`risk_score.ts`'s weights, caps and bands (imported, not restated) over the signals a presidential
protocol supports: procedural `invalidBallots`, `additionalVoters`; distribution `concentrated`,
`peerOutlier`, `swing` (against the previous presidential cycle, same round). `recount` and
`suemgMismatch` are not computable and are named in the file. `proceduralScore` is published per
section and equals the screening score (gated) — it is the only figure for a question about a
candidate.

Three calibration decisions, each measured:

1. **50-voter floor on the z-signals**, as for the ratios. Without it every named section in 2016
   and 2021 round 1 had 16–46 voters and scored 100 on one peer-outlier z.
2. **Named sections are critical with ≥2 signals**; one-signal scores still count in the bands.
3. **The concentration floor rises in a landslide** to max(80%, the round's p95 winner share).
   At the fixed 80% bar the signal drove 1,050 of 2006 round 1's 1,779 elevated sections.
   Withdrawing it instead was worse: a silent-but-known signal sits in the denominator, so
   dropping it took 2021 round 1 from 25 critical sections to 113.

Result: 1.4–11.4% of sections at „elevated" or above per round (parliamentary pooled ≈15%),
0–24 critical.

## Composite

Integrity: `sections` (band-weighted voters), `machine` and `missingFlash` (`flash.json`, 2021
only), `concentration` and `procedural` (`suspicious_settlements.json`). ⚠ A settlement flag
counts only where its producer marks it `discriminating` — otherwise concentration saturated at
100 in 7 of 10 rounds. Context: `polls` (agencies' round-one MAE, round 1 only). Benford, vote
switching, clusters and the neighbourhood swing have no presidential producer and are shown as
unavailable. Headline = mean of available integrity components, as on the parliamentary side.

Measured headline per round: 2001 9/3 · 2006 25/25 · 2011 18/11 · 2016 17/10 · 2021 19/12 —
calm except 2006 (elevated).

## Publishing

`data/*_pvr` is not in git; the ten `risk_score.json` files reach production through the bucket
sync, then `npm run deploy` for the code. Until the sync, the component renders nothing (absent).

## Open

- `PresidentialScreeningTile` now duplicates the procedural half shown in the new card; retiring it
  (and its producer) is a follow-up.
- No `/risk-analysis`-style detail page for presidential rounds; the ribbon has no „see full" link.
