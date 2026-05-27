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
  projects: StaraZagoraCapitalProject[];
  bySettlement: StaraZagoraCapitalSettlementRollup[];
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
  projects: PlevenCapitalProject[];
  bySettlement: PlevenCapitalSettlementRollup[];
  byFundingSource: PlevenCapitalFundingRollup[];
}
