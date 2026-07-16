// Frontend mirror of the budget pillar's JSON shapes. The offline pipeline
// (scripts/budget/) is the source of truth for these types; this file is the
// SPA-side copy of the slice the dashboard actually consumes, since src/ may
// not import from scripts/.

export interface Money {
  amountEur: number;
  amount: number;
  currency: "BGN" | "EUR";
}

// НЗОК (National Health Insurance Fund) annual budget-law breakdown — powers the
// health sector pack's "Къде отиват €5,5 млрд." bridge tile. Written by
// scripts/budget/nzok/__write_budget.ts from the annual ЗБНЗОК law.
export type NzokBudgetGroup = "care" | "admin" | "reserve";

export interface NzokBudgetLine {
  id: string;
  group: NzokBudgetGroup;
  bg: string;
  en: string;
  amount: Money;
}

export interface NzokBudgetYear {
  fiscalYear: number;
  /** "law" = adopted budget law; "draft" = Надзор-approved проект. */
  basis: "law" | "draft";
  currencyOfRecord: "BGN" | "EUR";
  totalExpenditure: Money;
  /** care + admin lines, then a computed "reserve" residual — Σ == total. */
  lines: NzokBudgetLine[];
}

export interface NzokBudgetFile {
  generatedAt: string;
  source: { publisher: string; law: string; url: string; description: string };
  latestYear: number;
  years: NzokBudgetYear[]; // descending by fiscalYear
}

// Latest НЗОК cash-execution snapshot (form B1, fund 5600) — cumulative
// revenue + expenditure YTD, paired with the budget-law plan for an execution
// gauge. Written by scripts/nzok/write_execution.ts.
export interface NzokExecutionFile {
  generatedAt: string;
  source: { publisher: string; url: string; description: string };
  year: number;
  month: number;
  asOf: string; // "YYYY-MM"
  currencyOfRecord: "BGN" | "EUR";
  revenueEur: number | null;
  expenditureEur: number | null;
}

// Monthly B1 cash-execution history (2022→) — every month НЗОК publishes, so the
// budget-bridge can draw the cumulative plan-vs-actual pace curve. Each point is
// cumulative YTD (resets every January). Written by
// scripts/nzok/write_execution.ts alongside execution.json.
export interface NzokExecutionPoint {
  year: number;
  month: number;
  asOf: string; // "YYYY-MM"
  currencyOfRecord: "BGN" | "EUR";
  revenueEur: number | null;
  expenditureEur: number | null;
}

export interface NzokExecutionHistoryFile {
  generatedAt: string;
  source: { publisher: string; url: string; description: string };
  latest: { year: number; month: number; asOf: string };
  points: NzokExecutionPoint[]; // ascending by asOf
}

// Latest monthly per-hospital БМП (hospital care) payment snapshot — the real
// money НЗОК pays out, OUTSIDE ЗОП. Written by
// scripts/nzok/write_hospital_payments.ts from the nhif.bg БМП report.
// State- vs municipally- vs privately-owned. Derived from the МЗ ЕЕОФ roster
// (state + municipal file it; anyone НЗОК pays who does not is private) with
// hand-verified overrides — data/budget/nzok/hospital_ownership.json, migration
// 065. null/undefined = the classifier could not place the facility (served as
// "unclassified"), never silently folded into private.
export type NzokOwnership = "state" | "municipal" | "private";

export interface NzokHospitalRow {
  /** 10-digit facility registration number (Рег.№ ЛЗ) — НЗОК-internal code. */
  regNo: string;
  name: string;
  rzokCode: string;
  rzokName: string;
  /** state | municipal | private; null when unclassified. */
  ownership?: NzokOwnership | null;
  /** Cumulative year-to-date paid, euros. */
  cumulativeEur: number;
  /** Paid in the report month, euros. */
  monthEur: number;
  /** Commerce-Register EIK, from the verified Рег.№→EIK crosswalk
   *  (hospital_eik.json). null when the facility isn't confidently matched. */
  eik?: string | null;
}

// Reverse index of the hospital-payments file keyed by EIK — powers the "НЗОК
// плащания за болнична помощ" tile on a hospital's own /company/:eik page. One
// EIK can run several ЛЗ facilities, so each carries the facility list + the sum.
// Written by scripts/nzok/write_hospital_payments.ts from the crosswalk.
// One company's hospital-care reimbursement for the latest period — the shape the
// /api/db/nzok-hospital-by-eik endpoint returns (nzok_hospital_reimbursement_by_eik).
// null-body when the EIK has no matched НЗОК payment.
// НЗОК pays a hospital through THREE separate monthly reports (migration 050):
// БМП (болнична медицинска помощ), лекарствени продукти applied inside БМП, and
// медицински изделия. A hospital's НЗОК income is their sum. Before 050 only
// `bmp` was ingested, so every per-hospital figure the site showed understated
// the facility — УМБАЛ „Света Екатерина" read 31.6M лв for FY2025 against a real
// 43.6M лв.
export type NzokPaymentStream = "bmp" | "drugs" | "devices";

export interface NzokStreamSplit {
  bmpEur: number;
  drugsEur: number;
  devicesEur: number;
}

export interface NzokHospitalReimbursement extends NzokStreamSplit {
  asOf: string; // "YYYY-MM-DD" (end of the report month)
  /** The company's ownership (state|municipal|private); null when unclassified. */
  ownership?: NzokOwnership | null;
  totalCumulativeEur: number;
  totalMonthEur: number;
  facilities: (NzokStreamSplit & {
    regNo: string;
    name: string;
    cumulativeEur: number;
    monthEur: number;
  })[];
}

// НЗОК hospital-payment momentum — the national monthly series plus the
// latest-YTD-vs-same-month-prior-year comparison per facility. DB-served from
// nzok_hospital_payments_trends() (/api/db/nzok-hospital-trends, migration 047).
// null-body until the corpus is loaded. Powers the "Динамика" tile — the time
// dimension the single-year competitor lacks.
export interface NzokTrendPoint {
  period: string; // "YYYY-MM"
  monthEur: number;
  cumulativeEur: number;
  facilityCount: number;
}

export interface NzokFacilityMomentum {
  regNo: string;
  name: string;
  eik: string | null;
  ownership?: NzokOwnership | null;
  currentYtdEur: number;
  /** YTD at the same month a year earlier; null when not reported then. */
  priorYtdEur: number | null;
}

export interface NzokHospitalTrendsFile {
  asOf: string; // "YYYY-MM-DD"
  currentPeriod: string; // "YYYY-MM"
  priorPeriod: string; // "YYYY-MM"
  hasPriorYear: boolean;
  /** €-floor the mover list filters on — single-sourced from the SQL payload so
   *  it stays in lockstep with the per-EIK percentile function's floor. */
  moverBaseFloorEur: number;
  national: NzokTrendPoint[]; // ascending by period
  currentYtdEur: number;
  priorYtdEur: number | null;
  facilities: NzokFacilityMomentum[]; // top by current YTD
}

// One company's hospital-spend-growth percentile among all matched hospitals —
// DB-served from nzok_hospital_momentum_by_eik() (/api/db/nzok-hospital-momentum-
// by-eik, migration 047). null when the EIK isn't a ranked hospital. Powers the
// transparent "grew faster than N% of hospitals" badge on /company/:eik.
export interface NzokHospitalMomentum {
  currentPeriod: string; // "YYYY-MM"
  priorPeriod: string; // "YYYY-MM"
  ownership?: NzokOwnership | null;
  currentYtdEur: number;
  priorYtdEur: number;
  /** YTD-vs-same-month-prior-year growth, as a fraction (0.1 = +10%). */
  yoyDelta: number;
  /** Hospitals ranked (prior-year base ≥ floor). */
  peerCount: number;
  /** Share of peers this hospital grew strictly faster than (0..1). */
  percentile: number;
  /** Median peer growth, for context. */
  medianDelta: number;
}

export interface NzokHospitalPaymentsFile {
  generatedAt: string;
  source: { publisher: string; url: string; description: string };
  asOf: string;
  year: number;
  month: number;
  currencyOfRecord: "BGN" | "EUR";
  totalCumulativeEur: number;
  monthTotalEur: number;
  facilityCount: number;
  /** National totals per stream at each stream's own latest month. */
  byStream?: Record<
    NzokPaymentStream,
    { cumulativeEur: number; monthEur: number; facilityCount: number }
  >;
  /** Private-vs-public split — the headline Диагноза cannot draw (they exclude
   *  private). Key is state|municipal|private|unclassified; each carries its €
   *  and facility count. Undefined on a pre-065 payload. */
  byOwnership?: Partial<
    Record<
      NzokOwnership | "unclassified",
      { cumulativeEur: number; facilityCount: number }
    >
  >;
  /** Each stream's own newest ingested month ("YYYY-MM"). The three reports are
   *  published on their own cadences, so these can differ — the tile footnotes
   *  the lag rather than silently dropping the lagging stream's money. */
  periodByStream?: Record<NzokPaymentStream, string>;
  byRzok: {
    code: string;
    name: string;
    cumulativeEur: number;
    facilityCount: number;
  }[];
  hospitals: NzokHospitalRow[]; // sorted by cumulativeEur desc
}

// Public-vs-private hospital comparison — the "ЕК съди България" band. НЗОК pays
// private hospitals like public ones, but private ones with >50% public funding
// are exempt from ЗОП (Directive 2014/24/ЕС — the EC lawsuit). This precomputed
// blob joins ownership + НЗОК payments + ГФО revenue (private-only) + each
// hospital's procurement-as-awarder activity so the tiles need one fetch.
// Written by scripts/nzok/write_public_private.ts.
export interface NzokPublicPrivateHospital {
  eik: string;
  name: string;
  nzokEur: number; // YTD cumulative (matches the pack's payment tiles)
  nzokAnnualEur: number; // annualised from YTD
  revenueEur: number | null; // latest ГФО total revenue
  revenueYear: number | null;
  nzokShare: number | null; // НЗОК ÷ revenue, same year (2023+ only)
  tenders3y: number; // contracts run as a ЗОП awarder, last 3 years
  // Compact multi-year ГФО series (folded in so the trend tile needs no second
  // fetch). Keyed by year → total revenue EUR + same-year НЗОК share (2023+).
  series?: Record<string, { rev: number; nzokShare?: number }>;
}
export interface NzokPublicPrivateFile {
  generatedAt: string;
  asOf: string;
  ytdMonths: number;
  source: { note: string };
  ownership: Record<
    NzokOwnership,
    { count: number; nzokEur: number; sharePct: number }
  >;
  privateStats: {
    total: number;
    withShare: number;
    over50: number;
    over50Pct: number;
    medianSharePct: number;
    zeroTender: number;
    over50NoTender: number;
    over50NoTenderAnnualEur: number;
    belowThreshold: number;
    over50WithTender: number;
  };
  hospitals: NzokPublicPrivateHospital[]; // private only, sorted by nzokEur desc
}

// (hospital_revenue.json is the committed canonical dataset + the writer's input;
// the UI reads the compact per-hospital series folded into public_private.json,
// so no separate client type/hook is needed here.)

// Annual gross drug-reimbursement rollup — НЗОК's second-largest budget line
// (~€1.33bn/yr), paid outside ЗОП. Written by
// scripts/nzok/write_drug_reimbursement.ts from the nhif.bg "Брутни разходи" XLS.
export interface NzokDrugInn {
  inn: string;
  atc: string;
  atcGroup: string; // ATC anatomical main group (first letter)
  eur: number;
  productCount: number;
  topProduct: string | null;
}

// One INN's year-over-year move (CMS "fastest-rising ingredient" pattern), or a
// newly-reimbursed molecule (priorEur 0, deltaPct null). Written by
// scripts/nzok/write_drug_reimbursement.ts from two full annual years.
export interface NzokDrugMover {
  inn: string;
  atc: string;
  atcGroup: string;
  eur: number;
  priorEur: number;
  /** eur/priorEur − 1; null for a newly-reimbursed molecule (no prior year). */
  deltaPct: number | null;
}

// Full-year-vs-full-year drug-spend movers — deliberately rigorous (two closed
// years) so a partial current year can't distort the comparison.
export interface NzokDrugGrowth {
  year: number;
  priorYear: number;
  floorEur: number;
  risers: NzokDrugMover[]; // biggest % increase, both years ≥ floor
  fallers: NzokDrugMover[]; // biggest % decrease
  newlyReimbursed: NzokDrugMover[]; // absent prior year, ≥ floor now
}

export interface NzokDrugReimbursementFile {
  generatedAt: string;
  source: { publisher: string; url: string; description: string };
  year: number;
  basis: "annual" | "ytd";
  totalEur: number;
  distinctInn: number;
  productRows: number;
  // sorted by eur desc — the ATC-group view slices/relies on the leading entries
  byAtcGroup: { code: string; bg: string; en: string; eur: number }[];
  top: NzokDrugInn[]; // sorted by eur desc
  /** Full-year YoY movers; null when two annual years aren't both available. */
  growth?: NzokDrugGrowth | null;
}

// Per-INN QUARTERLY reimbursement trend (migration 066) — the multi-period drug
// view a single-year corpus cannot draw. DB-served from nzok_drug_quarterly_
// overview() (/api/db/nzok-drug-quarterly). null-body until the corpus is loaded.
export interface NzokQuarterPoint {
  quarter: string; // "YYYY-Qn"
  eur: number;
}
export interface NzokDrugQuarterlyInn {
  inn: string;
  atc: string | null;
  atcGroup: string; // first ATC letter
  totalEur: number;
  latestYearEur: number;
  priorYearEur: number | null;
  /** Latest four-quarter window vs the prior four, as a fraction; null if no prior. */
  yoyDelta: number | null;
  series: NzokQuarterPoint[]; // ascending by quarter
}
export interface NzokDrugQuarterlyFile {
  quarters: string[]; // ascending
  /** Every INN name (folded form), ascending — the picker's search list. */
  allInns: string[];
  national: NzokQuarterPoint[]; // national total per quarter
  top: NzokDrugQuarterlyInn[]; // top molecules by total reimbursement
}
/** One molecule's full quarterly series — nzok_drug_quarterly_by_inn(). */
export interface NzokDrugQuarterlySeries {
  inn: string;
  atc: string | null;
  totalEur: number;
  series: NzokQuarterPoint[];
}

export type KfpSeries =
  | "revenue"
  | "expenditure"
  | "euContribution"
  | "balance"
  | "financing";

export type KfpCadence = "monthly" | "quarterly" | "annual";

export type ConstituentBudget =
  | "consolidated"
  | "state"
  | "municipal"
  | "social_security"
  | "eu_funds";

export type FactKind = "revenue" | "expenditure" | "financing" | "balance";

export interface KfpObservation {
  period: string;
  cadence: KfpCadence;
  fiscalYear: number;
  asOf: string;
  series: KfpSeries;
  constituentBudget: ConstituentBudget;
  executed: Money;
  planned: Money | null;
  sourceRef: { documentId: string; sheet?: string; rowLabel?: string };
}

// Hierarchy fields are reconstructed offline (the КФП source table flattens a
// 2-3 level tree into one column). `depth` 0 = top-level group, 1 = child leaf,
// 2 = sub-leaf where the source has 3 levels. `isSubtotal` marks rows whose
// children sum to them (running-sum match within tolerance) so the breakdown
// + flow tiles can render leaf → group → total without double-counting.
// `groupLabelBg/En` carry the nearest top-level group's label so a leaf can be
// drawn under its parent without walking the array.
export interface KfpSnapshotLine {
  labelBg: string;
  labelEn: string;
  planned: Money | null;
  executed: Money | null;
  depth: number;
  isSubtotal: boolean;
  groupLabelBg: string | null;
  groupLabelEn: string | null;
}

export interface KfpSnapshotSection {
  code: string;
  series: KfpSeries;
  kind: FactKind;
  labelBg: string;
  labelEn: string;
  planned: Money | null;
  executed: Money | null;
  lines: KfpSnapshotLine[];
}

export interface KfpSnapshot {
  period: string;
  fiscalYear: number;
  asOf: string;
  currency: "BGN" | "EUR";
  constituentBudget: ConstituentBudget;
  sections: KfpSnapshotSection[];
}

export interface KfpFile {
  generatedAt: string;
  country: "BG";
  constituentBudget: ConstituentBudget;
  sources: Record<string, string>;
  observations: KfpObservation[];
  snapshots: KfpSnapshot[];
}

// Full-year figures for one fiscal year, one Money per top-level series.
export interface FiscalYearSeriesFigures {
  revenue: Money | null;
  expenditure: Money | null;
  euContribution: Money | null;
  balance: Money | null;
  financing: Money | null;
}

// Per-fiscal-year roll-up — drives the election-scoped budget dashboard.
// `actual` is the December cumulative for a complete year; `projected` is a
// seasonal full-year estimate for the current incomplete year (null when no
// prior year anchors it).
export interface FiscalYearSummary {
  fiscalYear: number;
  complete: boolean;
  monthsAvailable: number;
  firstPeriod: string;
  lastPeriod: string;
  asOf: string;
  currency: "BGN" | "EUR";
  planned: FiscalYearSeriesFigures | null;
  actual: FiscalYearSeriesFigures;
  projected: FiscalYearSeriesFigures | null;
  projectionBasis: number | null;
  // Nominal BG GDP for the fiscal year, in EUR (whole units). Sourced from
  // data/macro.json's `nominalGdp` at pipeline-build time; the in-progress
  // year is projected forward via recent YoY growth. null when no value
  // can be sourced or projected.
  gdpEur: number | null;
}

export type BudgetDocKind =
  | "law"
  | "interim-law"
  | "amendment"
  | "execution-report"
  | "audit-report"
  | "kfp-feed";

export interface BudgetDocumentSource {
  role: "bill" | "promulgated" | "annex" | "report" | "dataset" | "resource";
  url: string;
  format: "html" | "pdf" | "xlsx" | "json" | "csv";
  annexKind?: string;
  label?: string;
}

export interface BudgetDocument {
  id: string;
  kind: BudgetDocKind;
  fiscalYear: number | null;
  seq: number;
  title: string;
  sources: BudgetDocumentSource[];
  promulgationDate?: string;
  reportDate?: string;
  discovery: "auto" | "manual" | "auto-confirmed";
  notes?: string;
}

export interface BudgetDocumentsFile {
  generatedAt: string;
  documents: BudgetDocument[];
}

// One reconciliation row — a classification node's budget journey for a fiscal
// year. Phase 3 (admin dimension): `planned` from the State Budget Law;
// `executed` null (ministry-grain execution not yet available), so
// `completeness` is "missing".
export interface ReconciliationRow {
  fiscalYear: number;
  dimension: "admin" | "functional" | "economic" | "program";
  nodeId: string;
  nodeNameBg: string;
  nodeNameEn: string;
  kind: FactKind;
  planned: Money | null;
  amendmentTrail: Array<{ seq: number; effectiveDate: string; money: Money }>;
  amended: Money | null;
  executed: Money | null;
  varianceEur: number | null;
  variancePct: number | null;
  completeness: "exact" | "partial" | "missing";
}

// A node in one of the four classification registries (admin / functional /
// economic / program). The frontend reads these to resolve names and, for
// programs, to find which ministry owns a program.
export interface ClassificationNode {
  id: string;
  dimension: "admin" | "functional" | "economic" | "program";
  nameBg: string;
  nameEn: string;
  parentId: string | null;
  ownerAdminId?: string; // program nodes — the owning ministry's admin node id
  eik?: string; // admin nodes — the procurement awarder EIK
  history: Array<{
    fiscalYear: number;
    sourceCode: string;
    sourceName: string;
  }>;
}

export interface ClassificationRegistry {
  dimension: "admin" | "functional" | "economic" | "program";
  generatedAt: string;
  nodes: ClassificationNode[];
}

// Phase 4 — a spending unit matched to its public-procurement awarder.
export interface MinistryProcurement {
  nodeId: string;
  eik: string;
  awarderName: string;
  totalEur: number;
  contractCount: number;
  mpConnectedContractorCount: number;
}

export interface MinistryProcurementFile {
  generatedAt: string;
  procurementIndexGeneratedAt: string | null;
  entries: MinistryProcurement[];
}

// Per-ministry rollup — the self-contained slice the ministry detail screen
// fetches (one small file instead of every year's whole-corpus reconciliation).
// `revenue`/`expenditure`/`balance` are the law-planned figures; `execution`,
// when present, adds the уточнен план + отчет from the year-end execution
// report — null for units/years without an ingested execution report.
export interface MinistrySeriesExecution {
  amended: Money | null;
  executed: Money | null;
  varianceEur: number | null;
  variancePct: number | null;
}

export interface MinistryRollupYear {
  fiscalYear: number;
  revenue: Money | null;
  expenditure: Money | null;
  balance: Money | null;
  execution: {
    revenue: MinistrySeriesExecution | null;
    expenditure: MinistrySeriesExecution | null;
  } | null;
  programs: Array<{
    nodeId: string;
    nameBg: string;
    nameEn: string;
    planned: Money | null;
    execution: MinistrySeriesExecution | null;
  }>;
}

export interface MinistryRollup {
  nodeId: string;
  nameBg: string;
  nameEn: string;
  eik: string | null;
  years: MinistryRollupYear[];
  procurement: MinistryProcurement | null;
}

export interface BudgetYearCoverage {
  fiscalYear: number;
  stages: Array<"law" | "amendment" | "execution">;
  kfpPeriods: string[];
  dimensions?: Partial<
    Record<"admin" | "functional" | "economic" | "program", boolean>
  >;
}

// Personnel coverage summary — tells the frontend which years have national
// Доклад aggregates and which have per-ministry headcount, without forcing
// it to fetch the full personnel.json before deciding whether to render the
// tile.
export interface PersonnelCoverage {
  nationalYears: number[];
  ministryYears: number[];
  ministryCountByYear: Record<string, number>;
  programmeCountByYear: Record<string, number>;
}

export interface BudgetIndex {
  generatedAt: string;
  lastIngest: string;
  country: "BG";
  kfp: {
    cadences: KfpCadence[];
    firstPeriod: string | null;
    lastPeriod: string | null;
    observationCount: number;
  };
  years: BudgetYearCoverage[];
  fiscalYears: FiscalYearSummary[];
  documentCount: number;
  personnel?: PersonnelCoverage;
}

// --------------------------------------------------------------------------
// Personnel — annual Доклад aggregates + per-ministry, per-programme headcount
// (the budget pipeline's 4th pillar, sliced from each ministry's
// "Отчет за изпълнението на програмния бюджет" alongside the Персонал line).
// --------------------------------------------------------------------------

export interface HeadcountTriple {
  law: number | null;
  amended: number | null;
  executed: number | null;
}

export interface PersonnelTriple {
  law: Money | null;
  amended: Money | null;
  executed: Money | null;
}

export interface PersonnelProgramme {
  code: string; // МФ classification code, e.g. "1600.01.01"
  nameBg: string;
  headcount: HeadcountTriple;
  personnel: PersonnelTriple;
  // executed personnel ÷ executed headcount — average annual cost per FTE,
  // including employer social-security contributions.
  avgAnnualCostPerFte: Money | null;
}

export interface MinistryHeadcountSummary {
  adminId: string;
  nameBg: string;
  nameEn: string;
  fiscalYear: number;
  totalHeadcount: HeadcountTriple;
  totalPersonnel: PersonnelTriple;
  avgAnnualCostPerFte: Money | null;
  programmes: PersonnelProgramme[];
}

// All values are щатни бройки (positions). Only `total` is reliably present
// in every Доклад since 2017; the rest are null when the year's report omits
// them or uses a phrasing the parser doesn't recognise.
export interface DokladPositions {
  total: number;
  central: number | null;
  territorial: number | null;
  municipal: number | null;
  municipalOwnRevenue: number | null;
  filled: number | null;
  vacant: number | null;
  vacantOverSixMonths: number | null;
}

export interface DokladData {
  year: number;
  positions: DokladPositions;
  structureCounts: {
    central: Record<string, number>;
    territorial: Record<string, number>;
  };
  // NSI list-headcount by administration type — excludes МВР + МО.
  nsiHeadcount: {
    central: Record<string, number>;
    territorial: Record<string, number>;
    total: number;
  };
}

export interface PersonnelFile {
  generatedAt: string;
  // Keyed by fiscal year (as string for JSON-friendly).
  national: Record<string, DokladData>;
  byMinistry: Record<string, MinistryHeadcountSummary[]>;
}

// --------------------------------------------------------------------------
// Revenue breakdowns — itemised sub-flows for the left side of the budget
// Sankey. The KFP feed publishes flat aggregates per tax type; these files
// drill each wedge into its sub-flows:
//   – customs/<year>.json: excise + import VAT + customs duties from
//     Митническа хроника (2022-2025; product split for 2025 only).
//   – vat/<year>.json: declared net VAT by 21 КИД-2008 sector from НАП
//     Table 3 (2024 only).
//   – pit/<year>.json: PIT by income type + by sector from НАП Tables
//     8/10 + Table 9 + narrative (2024 only).
// All amounts are in native currency (BGN ≤ 2025, EUR ≥ 2026) with `amountEur`
// pre-folded; share values are decimal 0..1.
// --------------------------------------------------------------------------

export interface CustomsRevenueLine {
  id: string;
  labelBg: string;
  labelEn: string;
  amount: number | null;
  amountEur: number | null;
  parent: string | null;
  share?: number | null; // decimal share of its parent line
}

export interface CustomsRevenueByCountry {
  name: string; // Bulgarian short name (Китай, Турция, САЩ, …)
  amount: number;
  amountEur: number;
  sharePct: number; // 0..100, as reported by the source
}

export interface CustomsBreakdownFile {
  generatedAt: string;
  country: "BG";
  fiscalYear: number;
  asOf: string;
  currency: "BGN" | "EUR";
  source: { publisher: string; document: string; url: string };
  lines: CustomsRevenueLine[];
  customsByCountry: CustomsRevenueByCountry[];
}

export interface VatSectorEntry {
  id: string; // KID-2008 letter (A..U) or "X" for "no sector"
  labelBg: string;
  labelEn: string;
  declaredToPay: number | null;
  declaredToPayEur: number | null;
  declaredToRefund: number | null;
  declaredToRefundEur: number | null;
  declaredNet: number | null;
  declaredNetEur: number | null;
  share: number | null; // signed share of total declared net (decimal 0..1, can be negative)
}

export interface VatBreakdownFile {
  generatedAt: string;
  country: "BG";
  fiscalYear: number;
  asOf: string;
  currency: "BGN" | "EUR";
  source: { publisher: string; document: string; url: string };
  declaredNet: number | null;
  declaredNetEur: number | null;
  sectors: VatSectorEntry[];
}

export interface PitLine {
  id: string;
  labelBg: string;
  labelEn: string;
  amount: number | null;
  amountEur: number | null;
  parent: string | null;
  share?: number | null; // decimal share of parent
}

export interface PitSectorEntry {
  id: string;
  labelBg: string;
  labelEn: string;
  amount: number | null;
  amountEur: number | null;
  share: number | null; // decimal 0..1
}

export interface PitBreakdownFile {
  generatedAt: string;
  country: "BG";
  fiscalYear: number;
  asOf: string;
  currency: "BGN" | "EUR";
  source: { publisher: string; document: string; url: string };
  lines: PitLine[];
  total: number | null;
  totalEur: number | null;
  bySector: {
    coverage: string; // human-readable note, e.g. "Jan-Nov 2024"
    total: number | null;
    totalEur: number | null;
    sectors: PitSectorEntry[];
  };
}

// ---------------------------------------------------------------------------
// Municipal transfers — Article 53 of the State Budget Law.
// Sliced per fiscal year under data/budget/municipal_transfers/{year}/:
//   - totals.json           — top-level transfer-type envelope
//   - by_municipality.json  — 265 per-община rows
//   - by_oblast.json        — 28 pre-aggregated oblast rollups
// Plus a small index.json listing the years on disk.
// ---------------------------------------------------------------------------

export type MunicipalTransferType =
  | "delegated"
  | "equalization"
  | "winter"
  | "capital"
  | "otherTargeted";

export interface MunicipalTransferTypeTotals {
  delegated: Money | null;
  equalization: Money | null;
  winter: Money | null;
  capital: Money | null;
  otherTargeted: Money | null;
}

export interface MunicipalTransferRow {
  ekatte: string;
  obshtinaCode: string;
  oblastCode: string;
  nuts3: string;
  nameBg: string;
  nameEn: string;
  total: Money | null;
  delegated: Money | null;
  equalization: Money | null;
  winter: Money | null;
  capital: Money | null;
  otherTargeted: Money | null;
}

export interface MunicipalTransfersTotalsFile {
  fiscalYear: number;
  asOf: string;
  source: { documentId: string; url: string };
  totals: MunicipalTransferTypeTotals;
  rowSum: {
    total: Money;
    delegated: Money;
    equalization: Money;
    winter: Money;
    capital: Money;
    otherTargeted: Money;
  };
  reconciliationDeltasEur: Partial<Record<MunicipalTransferType, number>>;
}

export interface MunicipalTransfersByMunicipalityFile {
  fiscalYear: number;
  asOf: string;
  source: { documentId: string; url: string };
  municipalities: MunicipalTransferRow[];
}

export interface MunicipalTransfersOblastRow {
  oblastCode: string;
  oblastNameBg: string;
  oblastNameEn: string;
  municipalityCount: number;
  total: Money;
  delegated: Money;
  equalization: Money;
  winter: Money;
  capital: Money;
  otherTargeted: Money;
}

export interface MunicipalTransfersByOblastFile {
  fiscalYear: number;
  asOf: string;
  source: { documentId: string; url: string };
  oblasts: MunicipalTransfersOblastRow[];
}

export interface MunicipalTransfersIndexFile {
  generatedAt: string;
  years: Array<{
    fiscalYear: number;
    municipalityCount: number;
    grandTotalEur: number;
  }>;
}

// Per-oblast shard — what region / municipality dashboards fetch. One file
// per oblast (28 of them) with the full multi-year history for the ~12-22
// municipalities in that oblast. Replaces the larger by_municipality.json
// for the per-page case where only one oblast's data is needed.

export interface MunicipalTransfersOblastShardMuniYear {
  ekatte: string;
  obshtinaCode: string;
  nameBg: string;
  nameEn: string;
  total: Money | null;
  delegated: Money | null;
  equalization: Money | null;
  winter: Money | null;
  capital: Money | null;
  otherTargeted: Money | null;
}

export interface MunicipalTransfersOblastShardYear {
  fiscalYear: number;
  asOf: string;
  source: { documentId: string; url: string };
  oblastTotals: {
    total: Money;
    delegated: Money;
    equalization: Money;
    winter: Money;
    capital: Money;
    otherTargeted: Money;
  };
  municipalities: MunicipalTransfersOblastShardMuniYear[];
}

export interface MunicipalTransfersOblastShard {
  oblastCode: string;
  oblastNameBg: string;
  oblastNameEn: string;
  years: MunicipalTransfersOblastShardYear[];
}

// ---------------------------------------------------------------------------
// NOI (National Social Security Institute) — fund-level execution snapshots.
// Sourced from per-fund B1 XLS files on nssi.bg. Drives the drilldown on the
// Sankey's "Социалноосигурителни фондове" line.
// ---------------------------------------------------------------------------

export type NoiFundCode = "5500" | "5591" | "5592";

export type NoiExpenseLineId =
  | "personnel"
  | "operations"
  | "interest"
  | "social_total"
  | "subsidies"
  | "capital_assets"
  | "capital_transfers"
  | "abroad"
  | "reserve";

export interface NoiExpenseLine {
  id: NoiExpenseLineId;
  labelBg: string;
  labelEn: string;
  planned: Money | null;
  executed: Money | null;
}

export interface NoiFundSnapshot {
  fundCode: NoiFundCode;
  fundLabelBg: string;
  fundLabelEn: string;
  fiscalYear: number;
  asOf: string;
  revenue: Money | null;
  expenditure: Money | null;
  balance: Money | null;
  // Sections III / IV / I.1 of the B1 sheet, whose identity is
  // V = I - II + III - IV. Optional: the artifact is bucket-served, so a
  // deploy may briefly serve a funds.json written before these were parsed.
  // Consumers must fall back rather than assume (see NoiFundYear).
  transfers?: Money | null;
  transfersCentralBudget?: Money | null;
  euContribution?: Money | null;
  taxRevenue?: Money | null;
  expenseLines: NoiExpenseLine[];
  pensionsBgn: number | null;
  shortTermBenefitsBgn: number | null;
}

// Depth-3 pension-type breakdown sourced from the annual yearbook PDF
// (Table 6.3). Only present for years where the yearbook has been ingested.
export interface NoiPensionTypeBreakdown {
  oldAge: Money;
  disability: Money;
  social: Money;
  occupational: Money;
  other: Money;
  total: Money;
}

export interface NoiFundsFile {
  generatedAt: string;
  source: {
    publisher: string;
    urlTemplate: string;
    description: string;
  };
  years: Array<{
    fiscalYear: number;
    asOf: string;
    // True when the year carries real B1 per-fund detail; false for the
    // yearbook-only shell the ingest publishes mid-cycle. Optional because the
    // artifact is bucket-served and a deploy may briefly serve a pre-flag
    // funds.json. Never read this directly — go through isCompleteNoiYear /
    // latestCompleteNoiYear in src/data/budget/noiYear.ts.
    complete?: boolean;
    totals: {
      revenue: Money;
      expenditure: Money;
      balance: Money;
      // III. Трансфери — the state top-up. Optional for the same bucket-serving
      // reason as the per-fund fields above; when absent, consumers fall back
      // to `expenditure - revenue`, which overstates it by the financed deficit.
      transfers?: Money;
      // I.1 Данъчни приходи — contributions proper, a subset of `revenue`
      // (which also carries fines, property income and fees).
      taxRevenue?: Money;
      pensions: Money;
      shortTermBenefits: Money;
    };
    funds: NoiFundSnapshot[];
    pensionTypes: NoiPensionTypeBreakdown | null;
  }>;
}

// ---------------------------------------------------------------------------
// НОИ pension statistics (the /pensions view) — mirror of the shapes written by
// scripts/budget/noi/parse_yearbook_xlsx.ts. Served at /budget/noi/pensions.json.
// ---------------------------------------------------------------------------

export interface NoiNationalYear {
  year: number;
  avgWageBgn: number | null;
  avgWageEur: number | null;
  avgInsurableIncomeBgn: number | null;
  avgInsurableIncomeEur: number | null;
  avgPensionBgn: number | null;
  avgPensionEur: number | null;
  pensionerCount: number | null;
}

export interface NoiPensionBracket {
  index: number;
  lo: number | null; // лв, null = open ("до X")
  hi: number | null; // лв, null = open ("над X")
  labelBg: string;
  count: number;
  share: number;
}

export interface NoiPensionDistributionYear {
  year: number;
  total: number;
  minPensionBgn: number | null;
  atCapCount: number | null;
  capBgn: number | null;
  aboveCapCount: number | null;
  povertyLineBgn: number | null;
  brackets: NoiPensionBracket[];
}

export interface NoiPensionOblastRow {
  code: string;
  nameBg: string;
  avgPensionBgn: number;
  avgPensionEur: number;
  yoyPct: number | null;
  pensions: number | null;
  bankPaid: number | null;
  cashPaid: number | null;
  cashShare: number | null;
}

export interface NoiPensionsFile {
  generatedAt: string;
  source: { publisher: string; urlTemplate: string; description: string };
  latestYear: number;
  years: number[];
  national: NoiNationalYear[];
  distribution: NoiPensionDistributionYear[];
  oblasts: Record<number, NoiPensionOblastRow[]>;
}

// ---------------------------------------------------------------------------
// КФН private pension funds (pillars 2 & 3) — mirror of the shapes written by
// scripts/budget/kfn/parse_kfn.ts. Served at /budget/kfn/funds.json.
// ---------------------------------------------------------------------------

export type KfnPillar = "UPF" | "PPF" | "VPF" | "VPFOS";

export interface KfnFundRow {
  pillar: KfnPillar;
  pillarLabelBg: string;
  pillarLabelEn: string;
  pillarNumber: 2 | 3;
  fundName: string;
  companyBg: string;
  companyEn: string;
  insured: number | null;
  netAssetsBgn: number | null;
  netAssetsEur: number | null;
}

export interface KfnFundsFile {
  generatedAt: string;
  period: string;
  periodLabel: string;
  source: { publisher: string; url: string; description: string };
  funds: KfnFundRow[];
}

// ---------------------------------------------------------------------------
// Investment Program — Приложение № 3 към чл. 113 of the State Budget Law.
// Per-project capital allocations to municipalities (3000+ projects in 2025).
// Drives the drilldown on the Sankey's "Капиталови разходи" leaf.
// ---------------------------------------------------------------------------

export type InvestmentCategory =
  | "roads"
  | "water_sewage"
  | "education"
  | "social"
  | "sports"
  | "culture"
  | "buildings"
  | "energy"
  | "other";

export interface InvestmentProjectRow {
  projectId: string;
  name: string;
  category: InvestmentCategory;
  municipalityNameBg: string | null;
  ekatte: string | null;
  obshtinaCode: string | null;
  oblastCode: string | null;
  oblastNameBg: string | null;
  cost: Money;
}

export interface InvestmentRollupRow {
  key: string;
  labelBg: string;
  labelEn: string;
  count: number;
  total: Money;
}

export interface InvestmentProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: { documentId: string; url: string };
  projectCount: number;
  grandTotal: Money;
  byOblast: InvestmentRollupRow[];
  byCategory: InvestmentRollupRow[];
  topProjects: InvestmentProjectRow[];
}

export interface InvestmentProgramIndexFile {
  generatedAt: string;
  years: Array<{
    fiscalYear: number;
    projectCount: number;
    grandTotalEur: number;
  }>;
}

// ---------------------------------------------------------------------------
// Municipal capital programmes — per-project line items from each община's
// annual "Поименен списък на обектите за строителство и капиталови разходи".
// Phase 1 covers Sofia (Столична община) only. The XLSX is one sheet of
// ~350 projects, parsed offline into the file below. Settlement and
// município pages within Sofia consume this to render a CapitalProjectsTile.
// ---------------------------------------------------------------------------

export interface SofiaCapitalAmounts {
  ownFunds: Money;
  stateSubsidy: Money;
  euFunds: Money;
  total: Money;
}

export interface SofiaCapitalProject extends SofiaCapitalAmounts {
  id: number;
  name: string;
  paragraph: string;
  functionLabel: string | null;
  activityLabel: string | null;
  rayons: string[]; // canonical район codes (e.g. ["BANKYA"])
}

export interface SofiaCapitalParagraph extends SofiaCapitalAmounts {
  code: string;
  labelBg: string;
}

export interface SofiaCapitalRayonRollup {
  code: string;
  labelBg: string;
  labelEn: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface SofiaCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
  };
  currency: "BGN" | "EUR";
  recapitulation: {
    total: SofiaCapitalAmounts;
    byParagraph: SofiaCapitalParagraph[];
  };
  projectCount?: number;
  projects: SofiaCapitalProject[];
  byRayon: SofiaCapitalRayonRollup[];
}

// Plovdiv shares Sofia's per-район rollup structure but has a simpler
// project shape (no §-paragraph hierarchy in the source PDF) and adds
// município identification fields so the tile can label itself even
// when used in a generic context.

export interface PlovdivCapitalProject {
  id: number;
  name: string;
  rayons: string[]; // canonical Plovdiv район codes (CENTRALEN, …)
  total: Money;
}

export interface PlovdivCapitalRayonRollup {
  code: string;
  labelBg: string;
  labelEn: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface PlovdivCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  projectCount?: number;
  projects: PlovdivCapitalProject[];
  byRayon: PlovdivCapitalRayonRollup[];
}

// Burgas — not районирана; the rollup is by funding source + by sub-
// settlement (the ~14% of rows that name a village or city quarter).
export interface BurgasCapitalFunding {
  stateSubsidy: Money;
  ownFunds: Money;
  debt: Money;
  euFunds: Money;
  other: Money;
  carryOverCommunity: Money;
  carryOverDelegated: Money;
}

export interface BurgasCapitalProject extends BurgasCapitalFunding {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

export interface BurgasCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface BurgasCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: {
    total: Money;
    funding: BurgasCapitalFunding;
  };
  projectCount?: number;
  projects: BurgasCapitalProject[];
  bySettlement: BurgasCapitalSettlementRollup[];
}

// Varna — districted município (VAR06, EKATTE 10135) with 5 райони
// (Одесос, Приморски, Младост, Аспарухово, Владислав Варненчик). Source
// PDF is rasterized scans (200dpi), so the parser pipeline has an OCR
// pre-step via Gemini Vision; the structured rollup mirrors Plovdiv's.
export interface VarnaCapitalProject {
  id: number;
  name: string;
  rayons: string[];
  total: Money;
}

export interface VarnaCapitalRayonRollup {
  code: string;
  labelBg: string;
  labelEn: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface VarnaCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
    ocrModel: string;
    ocrGeneratedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money }; // itemised sum (matches projects[])
  publishedRecap: Money | null; // ОБЩО figure Gemini found on the recap page (informational)
  projectCount?: number;
  projects: VarnaCapitalProject[];
  byRayon: VarnaCapitalRayonRollup[];
}

// Ruse — single município (RSE27, EKATTE 63427). Each of the 12 villages
// + 1 satellite town (Мартен) of obshtina Русе has its own sheet in the
// source XLSX, so per-settlement attribution is via sheet structure
// rather than free-text regex. Same JSON shape as Stara Zagora.
export interface RuseCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  spendingUnit: string;
  paragraph: string;
  years: string;
  total: Money;
}

export interface RuseCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface RuseCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  projectCount?: number;
  projects: RuseCapitalProject[];
  bySettlement: RuseCapitalSettlementRollup[];
}

// Stara Zagora — single município (no райони), same shape as Burgas
// minus the funding-source detail. The source PDF has 9 funding
// sub-columns but reliable extraction would require column-by-column
// positional reading; the v1 parser captures only the "Годишна задача
// общо" rollup column. Per-settlement tagging against the 51 known
// villages of obshtina SZR31.
export interface StaraZagoraCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

export interface StaraZagoraCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface StaraZagoraCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money }; // itemised sum (matches projects[])
  publishedRecap: Money | null; // PDF's "КАПИТАЛОВИ РАЗХОДИ - ОБЩО" — informational, includes city-wide rollups not in line items
  projectCount?: number;
  projects: StaraZagoraCapitalProject[];
  bySettlement: StaraZagoraCapitalSettlementRollup[];
}

// Vidin — single-município (VID09, EKATTE 10971). Oblast capital with
// 34 settlements (city + town Дунавци + 32 villages). Source is the
// year-end "Отчет капиталови разходи" .doc inside the council RAR
// bundle on vidin.bg; parsed directly by vidin.ts via textutil →
// regex (no OCR — the .doc is born-text). Achieves 90% per-village
// localisation, highest in the fleet because Vidin's bullets always
// tag the settlement explicitly.
export interface VidinCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

export interface VidinCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface VidinCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  publishedRecap: Money | null;
  projectCount?: number;
  projects: VidinCapitalProject[];
  bySettlement: VidinCapitalSettlementRollup[];
}

// Самоков — single-município (SFO39, EKATTE 65231) in Sofia oblast.
// 28 settlements (city + 27 villages, incl. resort к.к. Боровец).
// Source is a 10-page born-digital Excel-rendered PDF on samokov.bg
// (Приложение №5 to the council budget). OCR via Gemini Vision.
export interface SamokovCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

export interface SamokovCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface SamokovCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
    ocrModel: string;
    ocrGeneratedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  publishedRecap: Money | null;
  projectCount?: number;
  projects: SamokovCapitalProject[];
  bySettlement: SamokovCapitalSettlementRollup[];
}

// Велинград — single-município (PAZ08, EKATTE 10450) in Pazardjik
// oblast. 21 settlements (city + 20 villages). Source is the council's
// "ПРОЕКТ НА ПРОГРАМАТА ЗА КАПИТАЛОВИ РАЗХОДИ" — a clean born-digital
// PDF on m.velingrad.bg (mobile-prefix subdomain). Discovered via
// Google site search. OCR via Gemini Vision for robust extraction.
export interface VelingradCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

export interface VelingradCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface VelingradCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
    ocrModel: string;
    ocrGeneratedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  publishedRecap: Money | null;
  projectCount?: number;
  projects: VelingradCapitalProject[];
  bySettlement: VelingradCapitalSettlementRollup[];
}

// Дупница — single-município (KNL48, EKATTE 68789). NOT an oblast
// capital (Kyustendil oblast), 17 settlements (city + 16 villages).
// Source is a clean born-digital MINFIN B3 PDF on dupnitsa.bg —
// the September 2025 quarterly execution snapshot, accessed via the
// site's PHP service-download endpoint (requires Referer header).
// Text IS extractable but the layout is column-positional, so OCR
// via Gemini Vision for robust extraction (same template as Haskovo).
export interface DupnitsaCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

export interface DupnitsaCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface DupnitsaCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
    ocrModel: string;
    ocrGeneratedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  publishedRecap: Money | null;
  projectCount?: number;
  projects: DupnitsaCapitalProject[];
  bySettlement: DupnitsaCapitalSettlementRollup[];
}

// Ловеч — single-município (LOV18, EKATTE 43952). Oblast capital
// with 35 settlements (city + 34 villages). Source is the council's
// "Бюджет и капиталови разходи" — a 77-page scanned Konica Minolta
// PDF combining the resolution text + budget + capital. The capital
// project list sits on pages 36-42 (landscape multi-column funding-
// source breakdown). The operator slices those pages with pypdf and
// runs Gemini Vision OCR. The OCR sometimes mis-picks a multi-year
// column instead of the annual planned amount, so the published
// council total (49,781,917 BGN for 2025) is overridden via the
// parser's PUBLISHED_RECAPS map and the tile uses publishedRecap as
// its headline rather than the itemised sum.
export interface LovechCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

export interface LovechCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface LovechCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
    ocrModel: string;
    ocrGeneratedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  publishedRecap: Money | null;
  projectCount?: number;
  projects: LovechCapitalProject[];
  bySettlement: LovechCapitalSettlementRollup[];
}

// Кърджали — single-município (KRZ16, EKATTE 40909). Oblast capital
// with 118 settlements (city + 117 villages). Source PDF discovered
// via Google site:kardjali.bg search; born-digital text-extractable
// PDF (Excel-rendered) with project + actualisation variants. OCR
// via Gemini Vision for robust extraction of "било/става" amendment
// pairs (capture СТАВА).
export interface KardzhaliCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

export interface KardzhaliCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface KardzhaliCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
    ocrModel: string;
    ocrGeneratedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  publishedRecap: Money | null;
  projectCount?: number;
  projects: KardzhaliCapitalProject[];
  bySettlement: KardzhaliCapitalSettlementRollup[];
}

// Ямбол — single-município (JAM26, EKATTE 87374). Oblast capital,
// single-settlement (just the city — no surrounding villages, those
// are separate общини in Yambol oblast). Source is "Приложение 4/5
// Разчет за финансиране на капиталовите разходи" inside a RAR (2024+)
// or ZIP (2022-2023) bundled with the council budget on yambol.bg.
// PDF is born-digital (Excel-rendered) but column-positioned →
// Gemini Vision OCR for reliable extraction. No bySettlement.
export interface YambolCapitalProject {
  id: number;
  name: string;
  total: Money;
}

export interface YambolCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
    ocrModel: string;
    ocrGeneratedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  publishedRecap: Money | null;
  projectCount?: number;
  projects: YambolCapitalProject[];
}

// Габрово — single-município (GAB05, EKATTE 14218). Oblast capital
// with 134 settlements (city + 133 villages — the largest village
// count in the fleet). Source is the council's "Инвестиционна програма"
// (Приложение №5 to the budget), discovered via Google indexing of
// gabrovo.bg/files/budjet*/...pdf (the site itself is JS-rendered
// so harvester misses it). Born-digital PDF (Microsoft Print-to-PDF
// render of an underlying XLSX) but column-positioned layout → OCR
// via Gemini Vision for robust extraction.
export interface GabrovoCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

export interface GabrovoCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface GabrovoCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
    ocrModel: string;
    ocrGeneratedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  publishedRecap: Money | null;
  projectCount?: number;
  projects: GabrovoCapitalProject[];
  bySettlement: GabrovoCapitalSettlementRollup[];
}

// Хасково — single-município (HKV34, EKATTE 77195). Oblast capital
// with 37 settlements (city + 36 villages). Source is a 19-page born-
// digital landscape PDF on haskovo.bg (Прил. №7 МИНФИН B3 template);
// project descriptions wrap across lines, so the pipeline OCRs via
// Gemini Vision (haskovo_ocr.ts) for robust multi-line joins.
export interface HaskovoCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

export interface HaskovoCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface HaskovoCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
    ocrModel: string;
    ocrGeneratedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  publishedRecap: Money | null;
  projectCount?: number;
  projects: HaskovoCapitalProject[];
  bySettlement: HaskovoCapitalSettlementRollup[];
}

// Перник — single-município (PER32, EKATTE 55871). Oblast capital
// with 24 settlements (city + town Батановци + 22 villages). Source
// is a clean single-sheet XLS on pernik.bg, already denominated in
// EUR (post-euro adoption). No OCR. ~160 projects per fiscal year.
export interface PernikCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

export interface PernikCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface PernikCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  publishedRecap: Money | null;
  projectCount?: number;
  projects: PernikCapitalProject[];
  bySettlement: PernikCapitalSettlementRollup[];
}

// Велико Търново — single-município (VTR04, EKATTE 10447). Tier-2
// oblast capital with 89 settlements (city + town Дебелец + town
// Килифарево + 86 villages). Source is the council's "Приложения 1-22"
// XLSX on veliko-tarnovo.bg, sheet "Pril15" = Инвестиционна програма.
// Clean structured data — no OCR. 2025 plan is 92.16M BGN (~€47.1M)
// across 382 projects, of which ~70% carry an explicit settlement tag.
// The city of Велико Търново holds the lion's share (~60% by amount).
export interface VelikoTarnovoCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

export interface VelikoTarnovoCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface VelikoTarnovoCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  publishedRecap: Money | null;
  projectCount?: number;
  projects: VelikoTarnovoCapitalProject[];
  bySettlement: VelikoTarnovoCapitalSettlementRollup[];
}

// Казанлък — single-município (SZR12, EKATTE 35167) in Stara Zagora
// oblast. 20 settlements (3 towns: Казанлък, Крън, Шипка + 17 villages).
// Source is the council's "Приложения" PDF that accompanies the adopted
// 2025 budget — born-digital, 17 pages, with the capital programme
// (Приложение №4 — "Проект на инвестиционна програма и текущи ремонти")
// on pages 9-17. The site (kazanlak.bg) is Nuxt-rendered; the file URL
// was discovered via the page's _payload.json. The XLS budget file is
// password-protected, so we use the PDF. OCR via Gemini Vision.
// 2025: 201 projects, ~€7.9M (matches "Общо за Общината" exactly).
export interface KazanlakCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

export interface KazanlakCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface KazanlakCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
    ocrModel: string;
    ocrGeneratedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  publishedRecap: Money | null;
  projectCount?: number;
  projects: KazanlakCapitalProject[];
  bySettlement: KazanlakCapitalSettlementRollup[];
}

// МРРБ IPOP — Инвестиционна програма за общински проекти execution
// feed (nationwide companion to the per-project PLAN data already in
// data/budget/investment_program/{year}.json; same OP-YY.NNN-NNNN IDs).
// Source: a CSV export from ipop.mrrb.bg with per-project agreement /
// submitted / approved-awaiting / paid amounts in EUR, covering all
// 264 municipalities that have MRRB-funded projects.
//
// Stalled-project flag = agreement >= EUR 100k AND paid_pct < 5%.

export interface IpopProject {
  id: string; // "OP-YY.NNN-NNNN"
  description: string;
  oblastCode: string;
  oblastName: string;
  obshtinaCode: string;
  municipalityName: string;
  agreementEur: number;
  submittedEur: number;
  awaitingEur: number;
  paidEur: number;
  mrrbPaidEur: number;
  bbrPaidEur: number;
  paidPct: number;
  stalled: boolean;
}

export interface IpopMunicipalityRollup {
  obshtinaCode: string;
  municipalityName: string;
  oblastCode: string;
  oblastName: string;
  projectCount: number;
  stalledCount: number;
  agreementEur: number;
  submittedEur: number;
  awaitingEur: number;
  paidEur: number;
  mrrbPaidEur: number;
  bbrPaidEur: number;
  paidPct: number;
}

export interface IpopOblastRollup {
  oblastCode: string;
  oblastName: string;
  municipalityCount: number;
  projectCount: number;
  stalledCount: number;
  agreementEur: number;
  paidEur: number;
  paidPct: number;
}

export interface IpopMunicipalityFile {
  fiscalYear: number;
  generatedAt: string;
  obshtinaCode: string;
  municipalityName: string;
  oblastCode: string;
  oblastName: string;
  rollup: IpopMunicipalityRollup;
  projects: IpopProject[];
}

export interface IpopNationalFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
  };
  totals: {
    projectCount: number;
    municipalityCount: number;
    oblastCount: number;
    stalledCount: number;
    agreementEur: number;
    submittedEur: number;
    awaitingEur: number;
    paidEur: number;
    mrrbPaidEur: number;
    bbrPaidEur: number;
    paidPct: number;
  };
  byMunicipality: IpopMunicipalityRollup[];
  byOblast: IpopOblastRollup[];
}

// Монтана — single-município (MON29, EKATTE 48489) in Montana oblast.
// 24 settlements (1 town + 23 villages). Source is the 5-page scanned
// PDF "Капиталова програма за 2025 г." from montana.bg's budget portal.
// Pages 1-4 contain per-function sub-appendices (Прил. 7а/7б/7в/7д —
// funding-source breakdowns) that itemise the SAME projects shown on
// page 5; we use page 5 only (the consolidated 9-project list). A
// separate 3M театър ремонт line sits below the "ВСИЧКО" recap, so
// the headline (€29.1M) is the full itemised total, not the ВСИЧКО
// subtotal (~€27.6M). OCR via Gemini Vision.
export interface MontanaCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

export interface MontanaCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface MontanaCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
    ocrModel: string;
    ocrGeneratedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  publishedRecap: Money | null;
  projectCount?: number;
  projects: MontanaCapitalProject[];
  bySettlement: MontanaCapitalSettlementRollup[];
}

// Кюстендил — single-município (KNL29, EKATTE 41112) in Kyustendil
// oblast. 72 settlements (city + 71 villages — second-largest village
// count in the fleet after Gabrovo's 134). Source is the council's
// "Окончателен годишен план" PDF (a 41-page mixed scan + born-digital
// docket on obs.kyustendil.bg's DnevenRed folder); the capital
// programme is Приложение №6 on pages 30-40. Operator pre-slices those
// pages into -capital-pages.pdf before OCR via Gemini Vision.
// 2025 final plan: 246 projects, ~€11.0M (perfect recap match with
// "ОБЩО Капиталови разходи").
export interface KyustendilCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

export interface KyustendilCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface KyustendilCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
    ocrModel: string;
    ocrGeneratedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  publishedRecap: Money | null;
  projectCount?: number;
  projects: KyustendilCapitalProject[];
  bySettlement: KyustendilCapitalSettlementRollup[];
}

// Карлово — single-município (PDV13, EKATTE 36498) in Plovdiv oblast.
// 27 settlements (4 towns: Карлово, Калофер, Клисура, Баня + 23 villages).
// Source is a clean XLSX (Приложение № 7) on karlovo.bg served via the
// site's service-download-file.php endpoint. The workbook's "2025" sheet
// is the standalone annual plan; col "Обща сума за обекта" is the
// per-line headline. 2025 plan is 29.34M BGN (~€15.0M) across 136 projects.
export interface KarlovoCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

export interface KarlovoCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface KarlovoCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  publishedRecap: Money | null;
  projectCount?: number;
  projects: KarlovoCapitalProject[];
  bySettlement: KarlovoCapitalSettlementRollup[];
}

// Shumen — single-município (SHU30, EKATTE 83510). Oblast capital with
// 27 settlements (the city + 26 villages). Source is a 15-page
// born-digital PDF on shumen.bg (Приложение №6 — ПЛАН ЗА ФИНАНСИРАНЕ
// НА КАПИТАЛОВИТЕ РАЗХОДИ), discovered via the Playwright harvester.
// Ingested through the Gemini Vision OCR pre-step (shumen_ocr.ts).
export interface ShumenCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

export interface ShumenCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface ShumenCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
    ocrModel: string;
    ocrGeneratedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  publishedRecap: Money | null;
  projectCount?: number;
  projects: ShumenCapitalProject[];
  bySettlement: ShumenCapitalSettlementRollup[];
}

// Asenovgrad — single-município (PDV01, EKATTE 00702). Plovdiv oblast,
// 29 settlements (1 city + 28 villages). Source is a 10-page born-digital
// PDF on asenovgrad.bg, ingested through the Gemini Vision OCR pre-step
// in asenovgrad_ocr.ts + asenovgrad.ts rollup. Output shape mirrors
// Stara Zagora / Sliven.
export interface AsenovgradCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

export interface AsenovgradCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface AsenovgradCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
    ocrModel: string;
    ocrGeneratedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  publishedRecap: Money | null;
  projectCount?: number;
  projects: AsenovgradCapitalProject[];
  bySettlement: AsenovgradCapitalSettlementRollup[];
}

// Dobrich — single-município single-settlement (DOB28, EKATTE 72624).
// The city's villages live in a separate "Добрич-селска" rural община
// (DOB15). Source is an inline HTML table on dobrich.bg — no OCR or PDF
// parsing needed; scraped via fetch + regex by scripts/budget/
// capital_programs/dobrich.ts. Surfaces a per-funding-source rollup
// (Own funds / Targeted subsidy / Carry-overs / EU projects / …).
export interface DobrichCapitalProject {
  id: number;
  name: string;
  fundingSource: string | null;
  total: Money;
}

export interface DobrichCapitalFundingRollup {
  code: string;
  projectCount: number;
  total: Money;
}

export interface DobrichCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  publishedRecap: Money | null;
  projectCount?: number;
  projects: DobrichCapitalProject[];
  byFundingSource: DobrichCapitalFundingRollup[];
}

// Sliven — single-município, no райони (SLV20, EKATTE 67338). Tier-2
// oblast capital with 45 settlements (city + town Кермен + 43 villages).
// Source is a 23-page rasterized PDF on mun.sliven.bg, ingested through
// the OCR pre-step in sliven_ocr.ts + sliven.ts rollup. Output shape
// mirrors StaraZagora (per-village breakdown via "с." / "гр." prefix).
export interface SlivenCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

export interface SlivenCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface SlivenCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
    ocrModel: string;
    ocrGeneratedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  publishedRecap: Money | null;
  projectCount?: number;
  projects: SlivenCapitalProject[];
  bySettlement: SlivenCapitalSettlementRollup[];
}

// Pleven — single-município, no райони (PVN24, EKATTE 56722). Two source
// appendices: Прил. №4 (general capital, 7.59M BGN) + Прил. №10А (EU
// projects, 11.00M BGN). Granularity dimension is by SETTLEMENT (city +
// 24 outlying villages) and by FUNDING SOURCE. OCR-derived — see
// scripts/budget/capital_programs/pleven_ocr.ts.
export interface PlevenCapitalProject {
  id: number;
  name: string;
  settlement: string | null; // e.g. "гр. Плевен" / "с. Горталово"
  fundingSource: string | null; // SCREAMING_SNAKE_CASE code
  appendix: "PRILOZHENIE_4" | "PRILOZHENIE_10A";
  total: Money;
}

export interface PlevenCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface PlevenCapitalFundingRollup {
  code: string;
  projectCount: number;
  total: Money;
}

export interface PlevenCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
    ocrModel: string;
    ocrGeneratedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money }; // itemised sum
  publishedRecap: {
    prilozhenie4: Money | null;
    prilozhenie10A: Money | null;
    combined: Money | null;
  };
  projectCount?: number;
  projects: PlevenCapitalProject[];
  bySettlement: PlevenCapitalSettlementRollup[];
  byFundingSource: PlevenCapitalFundingRollup[];
}

// --- Municipal cash-execution (касово изпълнение по ЕБК) -------------------
// Plan-vs-actual revenue/expense by economic paragraph, parsed from the MINFIN
// B3 ЕБК report a few общини publish to data.egov.bg. Mirror of
// scripts/budget/municipal_execution/types.ts.

export interface MunicipalExecutionParagraph {
  code: string; // "01-00", "13-00"
  name: string;
  plan: Money; // Уточнен план
  actual: Money; // Отчет
  executionPct: number | null;
}

export interface MunicipalExecutionSide {
  plan: Money;
  actual: Money;
  executionPct: number | null;
  byParagraph: MunicipalExecutionParagraph[];
}

export interface MunicipalExecutionFile {
  obshtina: string;
  muniSlug: string;
  muniNameBg: string;
  muniNameEn: string;
  fiscalYear: number;
  period: {
    start: string;
    end: string;
    isFullYear: boolean;
    labelBg: string;
  };
  currency: "BGN" | "EUR";
  generatedAt: string;
  source: {
    publisher: string;
    datasetUrl: string;
    resourceUri: string;
    fetchedAt: string;
  };
  revenue: MunicipalExecutionSide;
  expense: MunicipalExecutionSide;
}

export interface MunicipalExecutionIndexEntry {
  muniSlug: string;
  obshtina: string;
  muniNameBg: string;
  muniNameEn: string;
  years: number[];
  latestFullYear: number | null;
}

export interface MunicipalExecutionIndexFile {
  generatedAt: string;
  municipalities: MunicipalExecutionIndexEntry[];
}

// ---------------------------------------------------------------------------
// Policy simulator baseline — data/budget/derived/policy_baseline.json,
// assembled by scripts/budget/run_policy_baseline.ts. Consumed by
// src/lib/bgTaxPolicy.ts via the /budget/simulator screen.
// ---------------------------------------------------------------------------

export interface PolicyBaselineCalibrationRow {
  year: number;
  modeledEur: number;
  actualEur: number;
  factor: number;
}

export interface PolicyBaselineFile {
  generatedAt: string;
  country: "BG";
  /** Latest closed КФП fiscal year — every scored Δ is per-year at this base. */
  baselineYear: number;
  gdpEur: number;
  /** Trailing-average nominal GDP growth, % — projects the deficit ratio
   *  onto baselineYear+1. */
  gdpGrowthPct: number;
  gdpNextEur: number;
  sources: Record<string, string>;
  revenue: {
    vatEur: number;
    pitEur: number;
    /** Share of the ДДФЛ line that scales with the flat rate (employment +
     *  non-employment; окончателен данък excluded). */
    pitRateSensitiveShare: number;
    /** Employment-only share of the ДДФЛ line — the portion scored over the
     *  earnings bands when a bracket schedule is set. */
    pitEmploymentShare: number;
    /** Non-employment share — scales with the schedule's base rate. */
    pitNonEmploymentShare: number;
    corporateEur: number;
    dividendEur: number;
    /** Excise anchors — Агенция "Митници" annual chronicle. Fuel is the
     *  combined line; diesel/petrol are itemised; tobacco/alcohol are the
     *  category lines (alcohol = spirits + beer combined). */
    exciseFuelEur: number;
    exciseDieselEur: number;
    excisePetrolEur: number;
    exciseTobaccoEur: number;
    exciseAlcoholEur: number;
    totalRevenueEur: number;
    /** Section IV budget balance at the baseline year (negative = deficit). */
    balanceEur: number;
  };
  /** Expenditure-side levers: pension indexation, administration headcount,
   *  МРЗ formula. Anchors documented in run_policy_baseline.ts. */
  expenditure: {
    pensions: {
      year: number;
      massEur: number;
      pensionerCount: number;
      /** COVID-supplement slice of the indexation base (60 лв × pensioners). */
      supplementMassEur: number;
      /** Swiss-rule inputs: trailing-4-quarter averages. */
      cpiPct: number;
      wageGrowthPct: number;
    };
    administration: {
      year: number;
      positionsTotal: number;
      positionsVacant: number;
      payrollEur: number;
      coveredHeadcount: number;
      payrollCoverageMinistries: number;
      payrollYear: number;
    };
    personnel: {
      /** Consolidated КФП Персонал line (wages + contributions), executed. */
      massEur: number;
      /** Curated share in restraint-exempt sectors (военни/полицаи/лекари/учители). */
      exemptShare: number;
    };
    defense: {
      /** NATO-definition spending, % of GDP (differs from COFOG GF02). */
      natoPctGdp: number;
      natoYear: number;
    };
    capital: {
      planEur: number;
      executedEur: number;
      /** Historical execution rate — cash effect of plan changes scales by it. */
      executionRate: number;
    };
    sscSelfPaid: {
      /** Everyone whose contributions the budget pays in full (КСО чл. 6,
       *  ал. 5): държавни служители + съдебна власт + отбрана и сигурност
       *  (the two НОИ SOD categories, summed). */
      count: number;
      /** Count-weighted average monthly insurable income across the groups. */
      avgWageEur: number;
    };
    health: {
      /** Employee insurable base at the baseline year (1pp collects on this). */
      baseEur: number;
    };
    minWage: {
      currentEur: number;
      /** КТ чл.244 recursion: current × (1 + wage growth). */
      formulaEur: number;
      wageGrowthPct: number;
      /** Share of the below-formula wage-uplift mass earned in the budget
       *  sector — the slice whose freeze is a payroll saving rather than a
       *  pure SSC/PIT loss (documented assumption; see run_policy_baseline.ts). */
      publicSectorShare: number;
    };
    /** Pensioner distribution by basic monthly pension (НОИ quarterly
     *  bulletin) — drives the minimum-pension lever. Optional: absent in
     *  baseline files generated before the lever shipped. */
    pensionFloor?: {
      asOf: string;
      /** Statutory minimum old-age pension (чл.68, ал.1 и 2 КСО), EUR/mo. */
      minimumEur: number;
      totalPensioners: number;
      /** Bands the floor slider can reach (≤ €700). */
      bands: { upToEur: number; count: number; midEur: number }[];
    };
    /** ISCED 1-3 teacher count + education-public vs economy-wide average
     *  wage — drives the teachers' 125%-peg lever. Optional: absent in
     *  baseline files generated before the lever shipped. */
    teachers?: {
      count: number;
      countYear: number;
      /** Education public-sector average annual wage, EUR — a proxy for
       *  teachers proper (includes non-teaching staff). */
      sectorWageEur: number;
      economyWageEur: number;
      wageYear: number;
      /** sectorWageEur / economyWageEur at the wage year. */
      currentRatio: number;
    };
    /** Non-pension social-protection base (COFOG GF10 − НОИ pension mass) for
     *  the social-benefits spending lever. Optional: absent in baseline files
     *  generated before the lever shipped (engine falls back to a constant). */
    socialBenefits?: { baseEur: number; cofogYear: number };
    /** Consolidated КФП „Лихви - общо" — the interest-on-debt spending base.
     *  Optional: see socialBenefits. */
    interest?: { baseEur: number; year: number };
    /** Consolidated КФП „Субсидии" — the general-subsidies spending base.
     *  Optional: see socialBenefits. */
    subsidies?: { baseEur: number; year: number };
  };
  /** Fitted earnings distribution (split log-normal body + Pareto tail) —
   *  anchors and validation in scripts/budget/earnings_distribution.ts. */
  earnings: {
    identityYear: number;
    sesWave: number;
    sigmaLower: number;
    sigmaUpper: number;
    medianEur: number;
    nEmployees: number;
    alpha: number;
    shareAboveCap: number;
    wageGrowthToBaseline: number;
    /** Grid-vs-НАП calibration at the identity year (validation stat). */
    kappaIdentityYear: number;
    /** Calibration the client applies at the baseline year. */
    kappa: number;
    /** МОД cap at the baseline year, EUR/month. */
    capEur: number;
    bands: { grossEur: number; workers: number }[];
  };
  /** Real НАП income-tier validation (taxable-base distribution of ДДФЛ
   *  filers, tax year 2023) — validates the fitted body + sources the tail
   *  ordering. Optional: present once run_income_tiers.ts has run. */
  incomeTiers?: {
    source: string;
    taxYear: number;
    currency: { bgnPerEur: number; note: string };
    totals: { filers: number; pitEur: number; taxableBaseEur: number };
    bins: {
      baseLowEur: number;
      baseHighEur: number | null;
      count: number;
      avgBaseEur: number;
      population: "all";
    }[];
    fitComparison: {
      napYearWageFactor: number;
      engineCountByBin: number[];
      bodyShareRatio: (number | null)[];
      cumThroughBin4: { engine: number; nap: number };
    };
    tail: {
      engineEmployeeAlpha: number;
      napAllFilerAlpha: number;
      napAlphaByThreshold: Record<string, number>;
      orderingOk: boolean;
      note: string;
    };
  };
  vat: {
    /** actual/modeled at the baseline year — bridges household-only modeled
     *  VAT to the full base. */
    factor: number;
    calibration: PolicyBaselineCalibrationRow[];
    structureYear: number;
    slices: {
      group: string;
      valueEur: number;
      regime: "standard" | "reduced" | "zero" | null;
    }[];
  };
  modIdentity: {
    /** НАП annual-report year the identity is computed against. */
    year: number;
    capEur: number;
    aboveCapMassEur: number;
    alphaLow: number;
    alphaCentral: number;
    alphaHigh: number;
  };
}

// Съдебна власт (judiciary) annual budget, as adopted in each year's ЗДБРБ.
// Powers the judiciary sector pack's budget-bridge tile: the judiciary's own
// revenue (съдебни такси!) and the per-body expenditure split (ВСС, ВКС, ВАС,
// ПРБ, съдилища, НИП, ИВСС, резерв). Written by scripts/budget/__write_judiciary.ts.
/** The eight rows of the ЗДБРБ „Органи на съдебната власт" table, plus the four
 *  revenue lines. Narrow so a colour/label map keyed on it stays exhaustive. */
export type JudiciaryBodyId =
  | "vss"
  | "vks"
  | "vas"
  | "prb"
  | "courts"
  | "nip"
  | "ivss"
  | "reserve";

export type JudiciaryRevenueId = "courtFees" | "property" | "fines" | "other";

export interface JudiciaryBudgetLine<
  Id extends string = JudiciaryBodyId | JudiciaryRevenueId,
> {
  id: Id;
  bg: string;
  en: string;
  amount: Money;
}

export interface JudiciaryBudgetYear {
  fiscalYear: number;
  basis: "law";
  currencyOfRecord: "BGN";
  totalRevenue: Money;
  totalExpenditure: Money;
  /** NB: currentExpenditure + capitalExpenditure < totalExpenditure. The balance
   *  is the contingency reserve (Резерв за непредвидени и/или неотложни разходи),
   *  a third bucket carried only as bodies[id="reserve"] — so these two fields do
   *  NOT decompose the total, and a bar built from them will not add up. */
  currentExpenditure: Money;
  capitalExpenditure: Money;
  /** Σ bodies == totalExpenditure (asserted at ingest). */
  bodies: JudiciaryBudgetLine<JudiciaryBodyId>[];
  /** Σ revenue == totalRevenue (asserted at ingest). */
  revenue: JudiciaryBudgetLine<JudiciaryRevenueId>[];
}

export interface JudiciaryBudgetFile {
  generatedAt: string;
  source: { publisher: string; law: string; url: string; description: string };
  latestYear: number;
  years: JudiciaryBudgetYear[]; // descending by fiscalYear
}

// ── ЕЕОФ quarterly hospital financials (migration 051) ──────────────────────
// Source: МЗ "Финансови показатели на лечебни заведения за болнична помощ",
// one XLSX per quarter under Наредба № 5 от 2019, 2019-Q2 →. Money columns are
// published in хил. лева and converted at ingest.
//
// NOTE ON RANKING: `costPerPatientEur` and the other per-patient indicators are
// emitted as raw values and are never ranked or percentile'd. A specialised
// centre spends multiples of a general hospital's per-patient figure because of
// its case mix, not its efficiency; ranking without a case-mix denominator (the
// clinical-pathway corpus, not yet ingested) reproduces the specialty, not a
// finding. See docs/plans/nzok-hospital-intelligence-v1.md.
export interface NzokFinancialIndicators {
  quarter: string; // "2025-Q3"
  ownership: "state" | "municipal";
  name: string;
  revenueEur: number;
  expenseEur: number;
  personnelCostEur: number;
  drugsDevicesCostEur: number;
  totalLiabilitiesEur: number;
  overdueLiabilitiesEur: number;
  /** FRACTIONS in 0..1, despite the `Pct` suffix the source column carries —
   *  0.427 means 42.7%. Format with a percent formatter, never by appending "%". */
  totalLiabilitiesRevenueSharePct: number | null;
  overdueLiabilitiesRevenueSharePct: number | null;
  bedOccupancyPct: number | null;
  /** Expense ÷ revenue, roughly. Below 1 means the quarter ran a surplus. */
  costEfficiencyCoef: number | null;
  patientsTreated: number | null;
  avgMonthlyBeds: number | null;
  avgLengthOfStay: number | null;
  costPerPatientEur: number | null;
}

export interface NzokHospitalFinancialsFile {
  quarter: string;
  hospitalCount: number;
  matchedEikCount: number;
  totalRevenueEur: number;
  totalExpenseEur: number;
  totalLiabilitiesEur: number;
  totalOverdueLiabilitiesEur: number;
  byOwnership: Record<
    "state" | "municipal",
    {
      hospitalCount: number;
      revenueEur: number;
      expenseEur: number;
      totalLiabilitiesEur: number;
      overdueLiabilitiesEur: number;
    }
  >;
  hospitals: (NzokFinancialIndicators & { eik: string | null })[];
}

export interface NzokFinancialsByEik {
  eik: string;
  name: string;
  ownership: "state" | "municipal";
  quarterCount: number;
  latest: NzokFinancialIndicators;
  series: NzokFinancialIndicators[]; // ascending by quarter
}

// ── Per-hospital drug unit prices (migration 052) ───────────────────────────
// Source: НЗОК "Справка 5_ПЛС2" (Наредба 10/2009), monthly, per лечебно
// заведение × pack × МКБ. Unit price = реимбурсна сума / (опаковки × брой в
// опаковка).
//
// Comparison is at PACK identity (`nationalNo`, falling back to `nzokCode`),
// NEVER at INN: one INN spans many packs (PEMETREXED has five), whose per-unit
// medians range from €17 to €66, so an INN-level ratio measures pack size.
// A `volumeFloorPacks` floor applies — a single-pack purchase has no negotiating
// context. Dispersion is not wrongdoing; persistent dispersion is the claim.
export interface NzokDrugPackStat {
  period: string; // "YYYY-MM"
  nationalNo: string;
  nzokCode: string;
  inn: string;
  tradeName: string;
  medianUnitEur: number;
  p25UnitEur: number;
  p75UnitEur: number;
  facilityCount: number;
  totalEur: number;
}

export interface NzokDrugOverpayRow {
  nationalNo: string;
  nzokCode: string;
  inn: string;
  tradeName: string;
  facility: string;
  regNo: string;
  eik: string | null;
  unitEur: number;
  medianUnitEur: number;
  ratio: number;
  overpayEur: number;
}

/** The /api/db/nzok-drug-overpay-by-eik body — an object, not a bare array. */
export interface NzokDrugOverpayByEik {
  eik: string;
  rows: NzokDrugOverpayRow[];
}

export interface NzokDrugUnitPricesFile {
  latestPeriod: string;
  volumeFloorPacks: number;
  distinctPacks: number;
  totalEur: number;
  topPacks: NzokDrugPackStat[];
  overpay: NzokDrugOverpayRow[];
}

// ── Clinical-activity corpus (migration 053) ────────────────────────────────
// Source: НЗОК monthly "Брой случаи и брой ЗОЛ по КП/АПр/КПр", aggregated to the
// annual (facility × procedure) grain. Cases are VOLUME, not value — the source
// carries the procedure code only (no name, no НРД price); `procType` is derived
// from the code's first letter (P→КП, A→АПр, K→КПр). This is the case-mix
// DENOMINATOR the pack previously lacked.
export interface NzokActivityProcedure {
  procedure: string;
  procType: string; // 'КП' | 'АПр' | 'КПр' | ''
  cases: number;
  // Брой ЗОЛ (insured persons). Retained for a planned "cases vs patients" view but
  // not rendered today: the annual value sums monthly counts, so a person treated
  // across several months is counted more than once — NOT a distinct-patient count.
  zol: number;
  facilityCount: number;
}

// One pathway-internal cases-per-bed outlier: a facility whose cases/bed on ONE
// procedure exceeds the median of SAME-TYPE hospitals on the SAME procedure. A
// signpost for a closer look, never a verdict — day-case pathways, referral
// concentration and bed accounting all move the ratio legitimately.
export interface NzokActivityOutlier {
  facility: string;
  eik: string | null;
  procedure: string;
  procType: string;
  hospitalType: string; // УМБАЛ | МБАЛ | СБАЛ | …
  cases: number;
  beds: number;
  casesPerBed: number;
  peerMedian: number;
  peerCount: number;
  ratio: number;
}

export interface NzokActivitiesFile {
  year: number;
  totalCases: number;
  distinctProcedures: number;
  distinctFacilities: number;
  caseBedFloors: { minCases: number; minBeds: number; minPeers: number };
  monthly: { period: string; cases: number; zol: number }[];
  topProcedures: NzokActivityProcedure[];
  caseBedOutliers: NzokActivityOutlier[];
}

/** Procedure code → official НРД name reference — data/budget/nzok/procedures.json,
 *  generated by scripts/nzok/write_procedure_names.ts. `names` is a flat
 *  { code: bgName } map (code as it appears in the activity feed: P###, A##, K##,
 *  with .N variants). Bulgarian only — the source publishes no English name. */
export interface NzokProcedureNamesFile {
  meta: {
    source: string;
    generatedAt: string;
    count: number;
    byType?: Record<string, number>;
  };
  names: Record<string, string>;
}

/** One hospital's case-mix — /api/db/nzok-activities-by-eik. Its top procedures
 *  by cases and each procedure's share of the national volume. */
export interface NzokActivityByEik {
  eik: string;
  year: number;
  totalCases: number;
  procedureCount: number;
  topProcedures: {
    procedure: string;
    procType: string;
    cases: number;
    zol: number;
    nationalCases: number;
    nationalSharePct: number;
  }[];
}

// ── Risk views (migration 054). Each is a TRANSPARENT composite — component
// values are always shown; the index is only a reading aid (see the migration
// header for the "signpost, not verdict" framing carried over from 052/053).

/** One hospital in the multi-signal risk ranking. Null component fields mean the
 *  hospital has no data for that signal (not zero) — `signalsPresent` states how
 *  many of the three axes it is scored on. */
export interface NzokHospitalRiskRow {
  eik: string;
  facility: string;
  ownership?: NzokOwnership | null;
  riskIndex: number; // 0-100, (drug + activity + overdue percentiles) / 3 × 100
  signalsPresent: number; // 1-3
  drugOverpayEur: number | null;
  drugPackCount: number | null;
  drugInnCount: number | null;
  drugMaxRatio: number | null;
  activityOutliers: number | null;
  activityMaxRatio: number | null;
  overdueEur: number | null;
  overduePct: number | null; // overdue liabilities as % of revenue
}

/** /api/db/nzok-hospital-risk — the top hospitals by risk index + coverage. */
export interface NzokHospitalRiskFile {
  drugYear: number;
  finQuarter: string;
  coverage: { drug: number; activity: number; financial: number };
  hospitals: NzokHospitalRiskRow[];
}

/** One geolocated hospital on the health-pack map (/api/db/nzok-hospital-map,
 *  migration 075). Metrics are the latest-period snapshots the map colours by. */
export interface NzokHospitalMapPoint {
  eik: string;
  name: string;
  city: string | null;
  oblast: string | null;
  loc: [number, number] | null; // [lng, lat]; null when not geocoded (filtered out)
  paymentsEur: number; // latest-period БМП cumulative payments
  drugOverpayEur: number; // latest-full-year drug overpay (0 when absent)
  activityCases: number; // latest-period clinical-activity case count (0 when absent)
}

/** /api/db/nzok-hospital-map — geolocated hospitals + coverage counts. `total` is
 *  every hospital with payments; `geocoded` (== hospitals.length) is those that
 *  resolved to a map point via the awarder_seats → settlements.json bridge. */
export interface NzokHospitalMapFile {
  asOf: string;
  total: number;
  geocoded: number;
  hospitals: NzokHospitalMapPoint[];
}

/** One pack beneath an INN in the by-drug risk board. */
export interface NzokDrugRiskPack {
  nationalNo: string;
  nzokCode: string;
  tradeName: string;
  medianUnitEur: number;
  overpayEur: number;
  facilityCount: number;
  maxRatio: number | null; // DB column is nullable; the writer always populates it
}

/** One molecule (INN) in the by-drug risk board, packs nested. */
export interface NzokDrugRiskInn {
  inn: string;
  overpayEur: number;
  facilityCount: number;
  packCount: number;
  maxRatio: number | null; // DB column is nullable; the writer always populates it
  packs: NzokDrugRiskPack[];
}

/** /api/db/nzok-drug-risk — molecules ranked by total overpay, packs nested. */
export interface NzokDrugRiskFile {
  year: number;
  drugs: NzokDrugRiskInn[];
}

/** One hospital on the drug-savings leaderboard (recoverable-euros framing). */
export interface NzokDrugSavingsHospital {
  eik: string | null;
  facility: string;
  overpayEur: number;
  packCount: number;
  innCount: number;
  maxRatio: number | null;
}

/** One molecule (INN) beside the hospital ranking, for context. */
export interface NzokDrugSavingsInn {
  inn: string;
  overpayEur: number;
  facilityCount: number;
  packCount: number;
  maxRatio: number | null;
}

/** /api/db/nzok-drug-savings (migration 055) — the national avoidable-overpay
 *  headline + per-hospital ranking. A signpost, not a verdict: a price gap can
 *  reflect volume, delivery period or contract terms. NULL when the corpus is
 *  empty. */
export interface NzokDrugSavingsFile {
  year: number;
  totalOverpayEur: number;
  hospitalCount: number;
  innCount: number;
  hospitals: NzokDrugSavingsHospital[];
  topInns: NzokDrugSavingsInn[];
}

/** One financial measure in a hospital's report card (migration 056): the
 *  hospital's latest value against the national median + the p40/p60 "around the
 *  median" tolerance band + its percentile among peers. Positional, not a verdict —
 *  case-mix legitimately drives most of these. */
export interface NzokFinancialMeasureCard {
  measure: string; // one of the eight measure keys (see nzokMeasures)
  value: number;
  median: number;
  p40: number;
  p60: number;
  n: number;
  percentile: number; // 0..1, share of peers strictly below this hospital
}

/** /api/db/nzok-financials-measures-by-eik — one hospital's report card. NULL
 *  when the hospital has no latest-quarter row past the bed floor. */
export interface NzokFinancialsMeasuresByEik {
  eik: string;
  quarter: string; // "YYYY-Qn"
  measures: NzokFinancialMeasureCard[];
}

/** One quarter of a measure's decile fan: the p10..p90 bands + median across
 *  hospitals, and the selected hospital's own value (null in quarters it lacks). */
export interface NzokFinancialsFanPoint {
  quarter: string; // "YYYY-Qn"
  n: number;
  p10: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  value: number | null;
}

/** /api/db/nzok-financials-measure-fan — one measure's decile fan over time with
 *  the selected hospital threaded through. NULL for an unknown measure. */
export interface NzokFinancialsMeasureFanFile {
  measure: string;
  eik: string;
  series: NzokFinancialsFanPoint[];
}

/** One hospital billing a given clinical pathway (migration 059). Cases are
 *  volume; `spendEur` (cases × НРД list tariff) is null until tariffs load. */
export interface NzokActivityProcedureHospital {
  eik: string | null;
  facility: string;
  rzok: string;
  cases: number;
  zol?: number;
  sharePct?: number;
  spendEur?: number | null; // migration 059: null until tariffs are loaded
}

/** /api/db/nzok-activity-by-procedure-spend — which hospitals bill one pathway,
 *  ranked by cases, with the НРД list tariff + implied spend when loaded. NHSU-
 *  style navigation; VOLUME by default, spend when tariffs exist. NULL for an
 *  unknown procedure. */
export interface NzokActivityByProcedureFile {
  procedure: string;
  procType: string;
  year: number;
  totalCases: number;
  totalZol?: number;
  facilityCount: number;
  priceEur?: number | null; // migration 059: null until tariffs load
  totalSpendEur?: number | null;
  hospitals: NzokActivityProcedureHospital[];
}

/** /api/db/nzok-casemix-by-eik (migration 059) — the case-mix expected-vs-actual
 *  signal: expected Σ(НРД list tariff × cases) vs actual БМП paid, with tariff
 *  coverage. NULL until tariffs are loaded (BG-egress ingest). A signpost for
 *  надлимитна/coding differences, not a verdict. */
export interface NzokCasemixFile {
  eik: string;
  year: number;
  expectedEur: number;
  actualEur: number | null;
  ratio: number | null;
  coverage: number; // share of the hospital's cases that had a tariff
}

/** /api/db/nzok-financials-coverage-by-eik (migration 058) — which ЕЕОФ quarters
 *  a hospital reports, so a reporting gap isn't misread as a spend drop. NULL when
 *  the hospital never reports. */
export interface NzokFinancialsCoverageFile {
  eik: string;
  totalQuarters: number;
  presentCount: number;
  firstPresent: string;
  lastPresent: string;
  quarters: { quarter: string; present: boolean }[];
}

/** One above-median (facility × pack) row on the molecule / pack detail pages.
 *  A price gap is a signpost, not a verdict (volume, delivery, contract terms). */
export interface NzokDrugDetailRow {
  nationalNo: string;
  nzokCode: string;
  tradeName: string;
  form: string | null;
  facility: string;
  regNo: string;
  eik: string | null;
  unitEur: number;
  medianUnitEur: number;
  ratio: number;
  units: number;
  overpayEur: number;
}

/** /api/db/nzok-drug-molecule — one molecule's (INN) detail: the /molecule/:inn
 *  page. Headline + its packs (pack-identity breakdown) + the per-facility
 *  above-median rows for the molecule. NULL when the INN has no such rows. */
export interface NzokDrugMoleculeFile {
  inn: string;
  year: number;
  overpayEur: number;
  facilityCount: number;
  packCount: number;
  maxRatio: number | null;
  packs: NzokDrugRiskPack[];
  rows: NzokDrugDetailRow[];
}

/** One month of a pack's dispersion band — the "is the gap widening?" series. */
export interface NzokDrugPackTrendPoint {
  period: string; // "YYYY-MM"
  medianUnitEur: number;
  p25UnitEur: number;
  p75UnitEur: number;
  facilityCount: number;
  totalPacks: number;
  totalEur: number;
}

/** One facility that paid above the year median for a pack, on the pack page. */
export interface NzokDrugPackFacilityRow {
  facility: string;
  regNo: string;
  eik: string | null;
  unitEur: number;
  medianUnitEur: number;
  ratio: number;
  units: number;
  overpayEur: number;
}

/** /api/db/nzok-drug-pack — one pack's detail: the /molecule/:inn/pack page.
 *  Latest-period dispersion band, the whole monthly series, and the above-median
 *  facilities. NULL when the pack has no priced rows. */
export interface NzokDrugPackFile {
  nationalNo: string;
  nzokCode: string;
  inn: string;
  tradeName: string;
  form: string | null;
  atc: string | null;
  volumeFloorPacks: number;
  latestPeriod: string;
  medianUnitEur: number;
  p25UnitEur: number;
  p75UnitEur: number;
  facilityCount: number;
  totalPacks: number;
  totalEur: number;
  series: NzokDrugPackTrendPoint[];
  rows: NzokDrugPackFacilityRow[];
}
