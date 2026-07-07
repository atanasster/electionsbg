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

// Latest monthly per-hospital БМП (hospital care) payment snapshot — the real
// money НЗОК pays out, OUTSIDE ЗОП. Written by
// scripts/nzok/write_hospital_payments.ts from the nhif.bg БМП report.
export interface NzokHospitalRow {
  /** 10-digit facility registration number (Рег.№ ЛЗ) — НЗОК-internal code. */
  regNo: string;
  name: string;
  rzokCode: string;
  rzokName: string;
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
export interface NzokHospitalByEikFile {
  generatedAt: string;
  asOf: string;
  year: number;
  month: number;
  /** eik → its hospital-care reimbursement (summed across the EIK's facilities). */
  byEik: Record<
    string,
    {
      totalCumulativeEur: number;
      totalMonthEur: number;
      facilities: { regNo: string; name: string; cumulativeEur: number }[];
    }
  >;
}

// One company's hospital-care reimbursement for the latest period — the shape the
// /api/db/nzok-hospital-by-eik endpoint returns (nzok_hospital_reimbursement_by_eik).
// null-body when the EIK has no matched НЗОК payment.
export interface NzokHospitalReimbursement {
  asOf: string; // "YYYY-MM-DD" (end of the report month)
  totalCumulativeEur: number;
  totalMonthEur: number;
  facilities: {
    regNo: string;
    name: string;
    cumulativeEur: number;
    monthEur: number;
  }[];
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
  byRzok: {
    code: string;
    name: string;
    cumulativeEur: number;
    facilityCount: number;
  }[];
  hospitals: NzokHospitalRow[]; // sorted by cumulativeEur desc
}

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

export interface NzokDrugReimbursementFile {
  generatedAt: string;
  source: { publisher: string; url: string; description: string };
  year: number;
  basis: "annual" | "ytd";
  totalEur: number;
  distinctInn: number;
  productRows: number;
  byAtcGroup: { code: string; bg: string; en: string; eur: number }[];
  top: NzokDrugInn[]; // sorted by eur desc
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
    totals: {
      revenue: Money;
      expenditure: Money;
      balance: Money;
      pensions: Money;
      shortTermBenefits: Money;
    };
    funds: NoiFundSnapshot[];
    pensionTypes: NoiPensionTypeBreakdown | null;
  }>;
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
