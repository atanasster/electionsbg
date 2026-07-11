# НЗОК intl-features implementation plan (v1)

Adopts the transferable ideas mined from OpenPrescribing, NHSU Ukraine, France
Assurance Maladie and CMS Care Compare (see memory `project_nzok_intl_features`)
into the health pack on `/awarder/121858220` (+ `/company/:eik`). Written
2026-07-11 after a data audit that **corrected the original research findings** —
read the audit section first, it changes the build order.

---

## Audit — what the data actually supports (corrections in bold)

| Feature | Original claim | Audit verdict |
|---|---|---|
| #1 Decile fan | monthly payments panel | **Best substrate is quarterly FINANCIALS (051), not payments.** Payments are a raw LEVEL; the fan needs a RATIO. Financials already hold ~15 per-hospital ratio metrics per quarter (cost_per_bed_day, ALOS, occupancy, cost_per_patient, overdue-share, drugs-cost-share, patients_per_doctor, cost_efficiency_coef…). FEASIBLE now, no new data. |
| #2 Case-mix expected-vs-actual | "we hold both factors — just join them" | **WRONG. Blocked.** `nzok_activities` (053) is **cases-only — no лв/€ value, no КП tariff** (design rule #1 explicitly defers the НРД price join). Needs a **new КП-tariff ingest** (Phase 4) before spend or case-mix cost can exist. |
| #3 КП spend tree | cases × tariff | **Partially blocked.** No per-КП value. Can ship a **case-VOLUME tree now** (per-КП cases per hospital, national→hospital); € version waits on Phase 4 tariffs. |
| #4 € savings leaderboard | trivial transform | **CONFIRMED, ship first.** `overpayByEik`/`overpayByInn`/`overpay` already computed in drug_unit_prices.json. National headline = **€1.97M avoidable overpay, 43 hospitals, FY2025** (verified). |
| #5 CMS report card | pure presentation | **CONFIRMED.** financials (051) has the measures. No mortality/леталитет column yet (source unlocated) — omit it. Shares substrate with #1. |
| €/unit national drug trend | feasible | **CONFIRMED.** `nzok_drug_pack_stats` (052) has total_eur + total_packs per (period, pack) across 17 months → €/unit trend + p25/median/p75 dispersion band. |
| ATC tree | needs external dict | **Better than thought.** `atc` code is already on packStats rows — no external join needed. |
| prescriber-specialty / demographic drug cuts, retail-prescription attribution, per-pharmacy reimbursement | not feasible | **CONFIRMED not feasible** — no BG open source. Data-advocacy only, not in this plan. |

**Two rules baked into every phase** (from the sources + our own corpus design):
1. A decile fan / cross-hospital comparison metric must be a **ratio/rate**, never a
   raw level (else big hospitals fill every top band).
2. No per-patient/per-unit ranking ships without a **case-mix denominator + volume
   floor** (already the hard rule in nzok-hospital-intelligence-v1.md).

---

## Shared infrastructure (build once, reused by #1 and #5)

**A. `DecileFan` chart component** (`src/screens/components/nzok/` or reuse charts dir).
Input: a per-period panel `{period, entityId, value}[]` + a selected entityId + a
polarity flag (`higherIsWorse`). Renders 9 faint decile bands over time, dashed
median, selected hospital in bold health-teal, "you are in the top/bottom N%"
caption. Recharts (already a dep). Theme-aware. Must handle skew (deciles, not σ).

**B. Measures registry** (`src/lib/nzokMeasures.ts`) — the OpenPrescribing
governance pattern. A typed array of vetted measures, each:
`{ key, title, why, unit, polarity, source, selector(hospitalRow)=>ratio }`.
Every measure renders identically (headline + DecileFan + rank). Curation bar:
clear benefit, single correct reading, room to improve, no patient-level indication
needed. Seed measures from financials (051): cost_per_bed_day, ALOS, occupancy,
cost_per_patient, overdue_liabilities_revenue_share_pct, drugs_devices_cost_share,
patients_per_doctor, cost_efficiency_coef.

---

## Phase 1 — Report card + decile fan (financials substrate) — NO new data

Delivers #1 and #5 together; they are the same distribution rendered two ways.

- **PG**: new migration `055_nzok_financials_distribution.sql` — one STABLE jsonb fn
  `nzok_financials_measure_distribution()` emitting, per measure per quarter, the
  9 deciles + median across all hospitals with a non-null value past a volume floor
  (e.g. beds ≥ 20), and `nzok_financials_measures_by_eik(p_eik)` returning that
  hospital's value + percentile + Above/Same/Below badge (tolerance-banded "Same as"
  = within ±X% of median, so noise isn't flagged) for every measure. ROUND sums,
  COLLATE "C", eik tiebreaks (determinism conventions).
- **Routes** (`functions/db_routes.js`): `nzok-financials-distribution`,
  `nzok-financials-measures-by-eik` (both `.catch(missingMigrationEmpty)`).
- **Hooks/types**: `useNzokFinancialsDistribution`, `useNzokFinancialsMeasuresByEik`.
- **Tiles** (mounted in NzokPack "Дейност и здраве" or a new "Съпоставка" band):
  - `NzokReportCardTile` — the CMS Care Compare card: rows = measures, each badged
    над / около / под националната медиана, optional composite. Awarder + company.
  - `NzokMeasureFanTile` — pick a measure (shared Radix Select), render `DecileFan`
    with this hospital threaded through. Deep-linkable `?measure=<key>`.
- **AI chat**: 1 tool `nzokHospitalMeasures(eik)` → the badge row.
- **Verify**: dev server, confirm badges + fan render for Св. Георги / Пирогов at
  1280px + 375px; console clean; median tick + "Same as" band visible.

## Phase 2 — Savings leaderboard + drug price trend + ATC tree — NO new data

Smallest, most press-shareable. All from drug_unit_prices.json (already served).

- `NzokSavingsLeaderboardTile` — national headline "**€1.97M avoidable overpay**
  (FY2025)" + per-hospital ranked (overpayByEik) rows → /company/:eik, expand to
  overpayByInn packs. Reframes existing % overpay as concrete €. No new data/PG.
- `NzokDrugUnitTrendTile` — for a picked pack/INN, plot national €/unit over the
  17 monthly periods (total_eur/total_packs) with the p25–p75 dispersion band + an
  outlier flag where a period's denominator is thin. Needs a small PG fn over
  `nzok_drug_pack_stats` OR compute client-side from an expanded packStats payload.
- ATC drill-down on the existing drug tiles: group INN spend by the `atc` prefix
  (ATC1→ATC3) already present on packStats — a collapsible therapeutic-class tree.
- **Verify**: headline € matches `Σ overpayByEik` (1,968,590); trend line renders.

## Phase 3 — КП case-volume tree + patient-facing lookup — NO new data (volume only)

NHSU navigable structure, honestly labelled as VOLUME (cases), not spend, until P4.

- `NzokPathwayTreeTile` — national → per-hospital КП case counts (activities
  facilityProcedures + procedures.json names). "Which hospitals do pathway X, and
  how many cases" + per-hospital "its КП mix". Carry the cases-not-value caveat.
- Patient-facing "find my hospital": on the place/governance view or a new
  `/health/hospital` search — pick settlement/oblast → hospitals + their КП mix +
  NHIF payment totals. Reuses payments + activities; map optional.
- **Verify**: pathway tree sums to national cases; caveat chip present.

## Phase 4 — КП tariff ingest (NEW DATA, feasibility-gated) — unlocks #2 + #3 €

This is the honest heavy phase. **Gate: first step is a feasibility spike** — confirm
the НРД Приложение 2 (клинична пътека цени) appendix is fetchable from nhif.bg the
same way `write_procedure_names.ts` fetches Приложение 17/18/19 (names), and that
tariffs resolve per КП per NRD year (mind day-case vs full, tiered "по-висока/
по-ниска" lines). If not cleanly fetchable → stop, keep P3 volume-only, log the gap.

If feasible:
- `scripts/nzok/write_pathway_tariffs.ts` (`--pathway-tariffs`) → `data/budget/nzok/
  pathway_tariffs.json` {code, nrdYear, priceEur}. Same fetch/parse discipline as
  procedure names (pdftotext/xlsx, `--dump`/`--from-dump`).
- Migration `056_nzok_pathway_tariffs.sql` + loader; join to `nzok_activities` →
  per-hospital per-КП **spend = cases × tariff**.
- Unlocks: (a) **€ spend** on the Phase-3 pathway tree; (b) **case-mix expected-vs-
  actual** — expected = Σ(national mean cost per КП × hospital cases in КП), ratio
  actual/expected as a DecileFan measure ("spends 1.4× what its case-mix predicts").
  This is the STAR-PU/MSPB honesty upgrade, and the thing OpenPrescribing Hospitals
  could NOT build (they lack activity denominators; we now would).
- **Changelog**: wire the new tariff dataset into recent_updates (pg-changelog-required).

## Phase 5 — Coverage panel + watcher trend-break digest — infra

- `NzokCoverageTile` — per-hospital which quarters/months of each form are present
  vs missing, so a reporting gap isn't misread as a spend drop (OP Hospitals idea).
- Watcher-driven CUSUM digest (NOT per-user subscribe — we're static JAMstack): the
  daily watcher emits "hospital X broke from its spend trend" / "INN Y price jumped"
  lines, mirroring OpenPrescribing price-concession alerts. Hosts in the existing
  watch pipeline; no backend/email infra.

---

## Build order & effort

1. **Phase 2** (savings leaderboard) — ship first: highest impact/effort, no PG, the
   €1.97M headline is a naiasno-post on its own.
2. **Phase 1** (report card + decile fan + measures registry) — the reusable spine.
3. **Phase 3** (volume pathway tree + hospital lookup).
4. **Phase 4** (tariff ingest → €/case-mix) — gated feasibility spike first.
5. **Phase 5** (coverage + alerts).

Deploy per phase: apply migration to Cloud SQL, `functions:db` redeploy,
`bucket:sync data/budget/nzok/` for any new JSON, firebase deploy. tsc
(tsconfig.app) + eslint clean each phase; EXPLAIN ANALYZE every new PG fn on the
worst-case entity (Св. Георги Пловдив).

## Explicitly out of scope (data-advocacy targets)
Prescriber-specialty & patient age/sex drug cuts; hospital→retail prescription
attribution; per-pharmacy outpatient reimbursement; mortality/леталитет in the
report card (source unlocated). Open LPP devices view = revisit only if a coded
НЗОК device-reimbursement nomenclature is found.
