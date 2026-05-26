// Frontend mirror of the budget pillar's JSON shapes. The offline pipeline
// (scripts/budget/) is the source of truth for these types; this file is the
// SPA-side copy of the slice the dashboard actually consumes, since src/ may
// not import from scripts/.

export interface Money {
  amountEur: number;
  amount: number;
  currency: "BGN" | "EUR";
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
