# PRD: Procurement risk-score expansion

Take the per-contract red-flag score from 4 signals to 8, prioritising
signals whose data is genuinely present in the АОП OCDS feed.

*Drafted 2026-05-21 after a competitive review of opentender.eu /
DIGIWHIST and the Open Contracting Partnership red-flags methodology,
then verified field-by-field against a live data.egov.bg bundle.*

## Context

- **What exists.** `src/data/procurement/useContractRiskFlags.tsx`
  computes a 0–100 score from four signals: MP-connected contractor
  (weight 50), debarred supplier (80), high awarder→contractor
  concentration (30), is-an-amendment (10). It is consumed by
  `ContractDetailScreen`, `CompanyContractsTile`, `AwarderContractsTile`
  and `RiskBadges`.
- **What prompted this.** A competitive scan flagged the 4-signal score
  as thin next to opentender.eu (~11 indicators) and OCP's Cardinal
  library. The scan *claimed* single-bidder, tender-period and
  procedure-rationale flags were "computable from fields you already
  have."
- **That claim was wrong, and this PRD corrects it.** `numberOfTenderers`,
  `tenderPeriodStartDate/EndDate` and `procurementMethodRationale` are
  **0% populated** in every contract shard. The stale comments at
  `useContractRiskFlags.tsx:7-9` and in `scripts/procurement/types.ts`
  describe fields the normalizer reads but never receives.

## Verified data availability

Downloaded a raw OCDS bundle (`data.egov.bg/resource/download/
3ec550fc-4058-445c-b938-cb21b6d1b0f3/json`, 2026-04-23…05-06, 2 343
releases) and inspected every release shape.

| Field | Status | Detail |
|---|---|---|
| `bids.statistics[]` (`measure:"bids"`) | **present, 88%** | Bid count per lot. Lives on the top-level `release.bids`, NOT on `tender`. The normalizer never reads this path → single-bidder data is silently lost. |
| `tender.procurementMethod` | present, ~100% of base contracts | `open` / `limited` / `selective`. Already on the contract row today. |
| `tender.value` | present, 846/848 tender releases | Estimated value. But within one fortnight bundle tender vs award releases share an `ocid` only ~4/848 of the time — the tender was published in an earlier fortnight. |
| `dateSigned` | present, 99% | Already on the contract row. |
| `tender.legalBasis` | present, ~82% of tender releases | `ЗОП` / EU directive CELEX ids. On the `tender` release only. |
| `tender.numberOfTenderers` / `numberOfBids` | **absent (0%)** | АОП does not publish bid counts under `tender`. |
| `tender.tenderPeriod` | **absent (0%)** | No advertisement-window dates anywhere in the feed. |
| `procurementMethodRationale` | **absent (0%)** | "Negotiated without notice" cannot be isolated. |

**Hard constraint.** Bid count and `procurementMethod` exist only for
2026+ OCDS bundles. The legacy 2011–2023 CSV corpus has neither. New
signals must *fail silent* on legacy rows — absence of data must never
itself raise the score, and the UI should mark pre-2026 contracts as
"limited signal coverage" rather than implying they are clean.

## Proposed signals

Four new signals. Each entry below is independently decidable.

### A. Single-bidder — *the marquee signal*

- **Detects.** Only one bid received on a contract that went through a
  competitive procedure — the strongest standard corruption-risk
  indicator (opentender weights it heavily).
- **Data.** `release.bids.statistics[]`, sum the `value` of entries
  where `measure === "bids"` across lots. 88% coverage on 2026 bundles.
- **Pipeline change.** `scripts/procurement/normalize.ts` — read
  `release.bids.statistics` instead of `tender.numberOfTenderers`;
  populate the existing `numberOfTenderers` field on the `Contract`
  row. The field, type and `dataTypes.ts` mirror already exist; only
  the extraction path changes.
- **Re-ingest.** Required. The 9 cached 2026 bundles must be re-fetched
  and re-normalised (`bundles.json` UUIDs are known; ~25 MB each). This
  regenerates `contracts/2026/`, the rollups, derived files and
  `index.json` — a large chunk of `data/procurement/`. Legacy shards
  are untouched.
- **Proposed weight.** 25. Single-bidder is common among legitimate
  procurements, so it should colour the score, not dominate it.
- **Caveat.** Fires only for 2026+. Display copy must say so.
- **Effort.** Medium.

### B. Non-open procedure

- **Detects.** Contract awarded via a `limited` or `selective`
  procedure rather than `open`. A blunt proxy — restricted procedures
  are lawful and routine — so it is a weak, supporting signal only.
- **Data.** `procurementMethod`, already on the contract row.
- **Pipeline change.** None.
- **Re-ingest.** None.
- **Implementation.** `useContractRiskFlags.tsx` — add
  `nonOpenProcedure: contract.procurementMethod != null &&
  contract.procurementMethod !== "open"` to the flag set.
- **Proposed weight.** 15.
- **Caveat.** Without `procurementMethodRationale` we cannot isolate
  "negotiated without prior publication" (the real flag). Consider
  surfacing this only when it *stacks* with another signal, rather than
  badging it standalone.
- **Effort.** Easy (frontend-only).

### C. Year-end signing cluster

- **Detects.** Contract signed in December — a proxy for budget-dumping
  / rushed end-of-year spending.
- **Data.** `dateSigned`, already on the row.
- **Pipeline change.** None.
- **Re-ingest.** None.
- **Implementation.** `useContractRiskFlags.tsx` — `isYearEnd:
  contract.dateSigned?.slice(5, 7) === "12"`.
- **Proposed weight.** 10.
- **Caveat.** Weak on its own; most useful as a stacking signal. Works
  on legacy rows too where `dateSigned` is present.
- **Effort.** Easy (frontend-only).

### D. Amendment value inflation

- **Detects.** A `contractAmendment` that raises the value materially
  above the original signed contract — replaces today's flat
  "is-an-amendment +10" with a graded signal.
- **Data.** Amendments are already stored as rows carrying the base
  contract's `ocid`. The base contract row is in the same corpus.
- **Pipeline change.** A derived pass — for each `ocid`, find the base
  `contract` row and each `contractAmendment`, compute
  `amendmentEur / baseEur`. Write `data/procurement/derived/
  amendment_inflation.json` keyed by amendment `key`. No raw bundle
  needed — runs over `data/procurement/contracts/`.
- **Re-ingest.** None (derived rebuild only).
- **Implementation.** New builder in `scripts/procurement/derived.ts`;
  new `useAmendmentInflation` hook; `computeRiskFlags` consumes it.
- **Proposed weight.** Keep +10 for any amendment; +25 when inflation
  exceeds 50% over the base value.
- **Caveat.** Some `ocid`s have no base `contract` row in our corpus
  (base predates our coverage) — leave those at the flat +10.
- **Effort.** Medium.

### Deferred — Estimate-vs-awarded gap

`tender.value` exists, but joining it to awards needs (1) the normalizer
to also ingest `tender`-tagged releases, currently skipped entirely, and
(2) a persistent cross-bundle `ocid → estimatedValueEur` index, since the
tender and the award land in different fortnights. Worth doing later;
out of scope for this round.

### Not feasible

Single-source/negotiated-procedure rationale, advertisement-period and
decision-period anomalies, "new company" supplier — АОП publishes none
of the required fields. ("New company" *is* reachable later via the
Commerce Registry SQLite that `update-connections` builds, as a separate
cross-reference pass.)

## Score model

Current: weights sum additively, capped at 100.
`MP_CONNECTED 50 · DEBARRED 80 · CONCENTRATION 30 · AMENDMENT 10`.

Proposed additions: `SINGLE_BIDDER 25 · NON_OPEN 15 · YEAR_END 10`,
amendment becomes `10` base / `25` when inflated >50%.

Open question — **the cap.** With 7–8 stacking signals, scores will
saturate at 100 more often and lose discriminating power. Options:
(a) keep the cap, accept saturation; (b) raise the cap and renormalise
for display; (c) move to a weighted-max or tiered model. Recommend
deciding this once the signal set is locked.

## Phasing

1. **Phase 1 — frontend-only.** Signals B + C. No pipeline change, no
   re-ingest, fully reversible. Score 4 → 6. Lands in one edit to
   `useContractRiskFlags.tsx` plus `RiskBadges.tsx` copy.
2. **Phase 2 — normalizer fix.** Signal A. Edit `normalize.ts`,
   re-fetch + re-ingest the 9 cached 2026 bundles, regenerate rollups /
   derived / index. Score → 7. Add a "2026+ only" coverage note to the
   contract UI.
3. **Phase 3 — derived pass.** Signal D. New `derived.ts` builder +
   hook. Score → 8.

## Risks & open questions

- **Re-ingest blast radius (Phase 2).** Regenerates 55k+ files under
  `data/procurement/`. Run on a clean branch; diff `index.json.totals`
  before/after to confirm only the bid-count field changed.
- **Legacy gap is visible.** Pre-2026 contracts will score lower purely
  because three signals can't fire. Mitigate with explicit UI copy, not
  by inferring risk from missing data.
- **`procurementMethod` `null` rows.** All `contractAmendment` rows lack
  it (it is on the base contract). Signal B must treat `null` as
  "unknown", never as "non-open".
- **Cap saturation** — see Score model above.
- **Stale comments.** `useContractRiskFlags.tsx:7-9` and the
  `numberOfTenderers` / `tenderPeriod*` doc-comments in
  `scripts/procurement/types.ts` describe data that never arrives —
  correct or delete them as part of whichever phase ships first.
