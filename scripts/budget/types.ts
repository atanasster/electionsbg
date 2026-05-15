// Shapes for the Budget pillar — the full lifecycle of the Bulgarian state
// budget: the accepted budget law, mid-year amendments ("актуализация"), the
// audited year-end execution report, and the continuous КФП consolidated
// fiscal series.
//
// Two record families, deliberately kept separate (see the plan):
//   - KfpObservation — periodic, scope-consolidated time series.
//   - BudgetFact     — annual, multi-dimensionally classified law/amendment/
//                      execution figures (Phase 2+).
//
// Phase 1 populates KfpObservation + the document index + the (empty)
// classification registries. BudgetFact / ReconciliationRow are defined here
// up front so later phases import rather than redefine.

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

// Every monetary value carries the euro figure (the display + aggregate value)
// plus the native amount/currency for the "originally …" footnote. BGN folds
// to EUR at the locked peg via src/lib/currency.ts. Bulgaria switched BGN→EUR
// on 2026-01-01, so historical budget data is BGN and 2026+ is EUR.
export interface Money {
  amountEur: number;
  amount: number;
  currency: "BGN" | "EUR";
}

// ---------------------------------------------------------------------------
// KfpObservation — КФП consolidated fiscal series (Phase 1)
// ---------------------------------------------------------------------------

export type KfpCadence = "monthly" | "quarterly" | "annual";

// Which budget the figure belongs to. The State Budget Law covers only the
// "state" sub-budget; the КФП is "consolidated" (state + municipal + social
// security + EU funds). The reconciler must never silently sum across scopes.
export type ConstituentBudget =
  | "consolidated"
  | "state"
  | "municipal"
  | "social_security"
  | "eu_funds";

// A single point on the time axis: one series, one period, one budget scope.
// `executed` is always present; `planned` carries the budget-law column when
// the source publishes it (the data.egov.bg feed does for fiscal years whose
// law was in force; the post-changeover 2026 files leave it empty).
export interface KfpObservation {
  period: string; // "2025" | "2025-Q3" | "2025-09"
  cadence: KfpCadence;
  fiscalYear: number;
  asOf: string; // ISO YYYY-MM-DD — the execution cut-off date
  series: KfpSeries;
  constituentBudget: ConstituentBudget;
  executed: Money;
  planned: Money | null;
  sourceRef: BudgetSourceRef;
}

// The five top-level sections of the Bulgarian budget execution table.
// `euContribution` is Bulgaria's contribution to the EU budget; `balance` is
// I − II − III; `financing` covers it.
export type KfpSeries =
  | "revenue"
  | "expenditure"
  | "euContribution"
  | "balance"
  | "financing";

// One line within a section of the latest detailed snapshot. Best-effort
// display data — the source table has no machine-readable nesting, so Phase 1
// keeps the lines flat under their section. Phase 2 introduces the economic
// classification crosswalk that gives this real structure.
export interface KfpSnapshotLine {
  labelBg: string;
  labelEn: string;
  planned: Money | null;
  executed: Money | null;
}

export interface KfpSnapshotSection {
  code: string; // "I" … "V"
  series: KfpSeries;
  kind: FactKind;
  labelBg: string;
  labelEn: string;
  planned: Money | null;
  executed: Money | null;
  lines: KfpSnapshotLine[];
}

// The most recent monthly snapshot, with the full section + line breakdown.
// Drives the dashboard's breakdown tile without forcing the SPA to walk the
// whole observations array.
export interface KfpSnapshot {
  period: string;
  fiscalYear: number;
  asOf: string;
  currency: "BGN" | "EUR";
  constituentBudget: ConstituentBudget;
  sections: KfpSnapshotSection[];
}

// Full-year figures for one fiscal year, one Money per top-level series.
// `null` for a series means the source did not carry it.
export interface FiscalYearSeriesFigures {
  revenue: Money | null;
  expenditure: Money | null;
  euContribution: Money | null;
  balance: Money | null;
  financing: Money | null;
}

// Per-fiscal-year roll-up. Drives the election-scoped budget dashboard: the
// headline cards show full-year figures (the December cumulative for a
// complete year, a seasonal projection for the current one).
export interface FiscalYearSummary {
  fiscalYear: number;
  // True when a December snapshot exists — the cumulative December figure is
  // the full-year actual.
  complete: boolean;
  monthsAvailable: number;
  firstPeriod: string;
  lastPeriod: string; // the as-of period the `actual` figures reflect
  asOf: string; // ISO date of lastPeriod's snapshot
  currency: "BGN" | "EUR";
  // From the budget-law ("Закон") column — the same for every month of the
  // year. null when the source leaves it empty (the post-euro 2026 feed does).
  planned: FiscalYearSeriesFigures | null;
  // Cumulative execution as of `lastPeriod` — equals the full-year actual when
  // `complete`.
  actual: FiscalYearSeriesFigures;
  // Seasonal full-year projection for an incomplete year: actual ÷ (the prior
  // complete year's cumulative share at the same calendar month). null when
  // the year is complete, or when no prior fiscal year has data at the
  // matching month to anchor the share.
  projected: FiscalYearSeriesFigures | null;
  projectionBasis: number | null; // the prior fiscalYear used as the anchor
}

// data/budget/kfp.json — committed. Small even with full monthly history.
export interface KfpFile {
  generatedAt: string;
  country: "BG";
  constituentBudget: ConstituentBudget;
  sources: Record<string, string>;
  observations: KfpObservation[];
  // The latest detailed snapshot per fiscal year (one entry per FY).
  snapshots: KfpSnapshot[];
}

// ---------------------------------------------------------------------------
// BudgetFact — law / amendment / execution figures (Phase 2+)
// ---------------------------------------------------------------------------

export type BudgetStage = "law" | "amendment" | "execution";
export type FactKind = "revenue" | "expenditure" | "financing" | "balance";

// `seq` orders amendments within a year (0 = law/execution, 1..N = Nth
// amendment). `effectiveDate` is the Държавен вестник promulgation date.
export interface FactVersion {
  stage: BudgetStage;
  seq: number;
  effectiveDate: string;
  documentId: string;
}

// Partial by design: null = "this source does not classify on this axis"
// (semantically distinct from "the root node"). The four dimensions are
// independent classification systems, not levels of one tree.
export interface ClassificationRef {
  admin: string | null;
  functional: string | null;
  economic: string | null;
  program: string | null;
  programLine: string | null;
}

export type ClassificationDimension =
  | "admin"
  | "functional"
  | "economic"
  | "program"
  | "programLine";

export interface BudgetFact {
  key: string; // sha256(fiscalYear|version|kind|classification|sourceRef)[:12]
  fiscalYear: number;
  version: FactVersion;
  kind: FactKind;
  classification: ClassificationRef;
  // The dimensions this fact's source actually populates — the join key for
  // reconciliation. Only facts sharing a grain may be compared.
  grain: ClassificationDimension[];
  money: Money;
  sourceRef: BudgetSourceRef;
  // Set when crosswalk-overrides.json patched this fact. Carried into
  // reconciliation so the UI can footnote "value corrected from source".
  curated?: boolean;
}

// ---------------------------------------------------------------------------
// Reconciliation — planned → amended → executed → variance (Phase 2+)
// ---------------------------------------------------------------------------

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
  // "exact" — both sides at this grain; "partial" — one side aggregated up
  // from a finer grain; "missing" — a stage absent.
  completeness: "exact" | "partial" | "missing";
}

// ---------------------------------------------------------------------------
// Classification registries — data/budget/classification/<dimension>.json
// ---------------------------------------------------------------------------

// Hand-maintained, committed. Mirrors data/canonical_parties.json: a stable
// `id` with a history[] of per-year source codes. Phase 1 ships these empty
// but structured; Phase 2+ populates them.
export interface ClassificationNode {
  id: string; // stable, never reused: "min-finance", "fn-education"
  dimension: "admin" | "functional" | "economic" | "program";
  nameBg: string;
  nameEn: string;
  parentId: string | null;
  ownerAdminId?: string; // program nodes: which ministry owns it
  eik?: string; // admin nodes: ministry EIK — the Phase 4 procurement join key
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

// data/budget/crosswalk-overrides.json — committed, hand-edited. Kept separate
// from the regenerable facts/ tree so a re-parse never clobbers corrections.
export interface CrosswalkOverrides {
  // "the source printed code X this year but it's really node Y"
  codeRemap: Array<{
    dimension: ClassificationDimension;
    fiscalYear: number;
    sourceCode: string;
    nodeId: string;
    note?: string;
  }>;
  // "fact key K had a mis-parsed amount; the audited correct value is …"
  factPatch: Array<{
    key: string;
    amount?: number;
    note?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Document index — data/budget/documents.json
// ---------------------------------------------------------------------------

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
  annexKind?: string; // for annex artifacts: "law-admin", "law-program", …
  label?: string;
}

export interface BudgetDocument {
  id: string; // stable: "law-2025", "amendment-2024-1", "audit-2023", "kfp-egov"
  kind: BudgetDocKind;
  fiscalYear: number | null; // null for the rolling КФП feed
  seq: number; // 0 for law/execution/audit, 1..N for amendments
  title: string;
  sources: BudgetDocumentSource[];
  promulgationDate?: string;
  reportDate?: string;
  // "auto" — discovered by the scraper this run; "manual" — hand-curated;
  // "auto-confirmed" — discovered then reviewed.
  discovery: "auto" | "manual" | "auto-confirmed";
  notes?: string;
}

export interface BudgetDocumentsFile {
  generatedAt: string;
  documents: BudgetDocument[];
}

// ---------------------------------------------------------------------------
// Procurement cross-link — data/budget/derived/ministry_procurement.json
// ---------------------------------------------------------------------------

// One first-level spending unit matched to its public-procurement awarder
// (by name → EIK), with that awarder's procurement footprint. Lets the budget
// dashboard follow a ministry's appropriation through to the contracts it
// actually awarded — and flag the MP-connected ones.
export interface MinistryProcurement {
  nodeId: string; // admin classification node id
  eik: string; // the matched procurement awarder EIK
  awarderName: string; // the awarder's name as it appears in the procurement data
  totalEur: number; // total awarded by this ministry across all years
  contractCount: number;
  // Distinct MP-connected contractors this ministry has paid (0 when the
  // procurement MP cross-reference is absent).
  mpConnectedContractorCount: number;
}

export interface MinistryProcurementFile {
  generatedAt: string;
  // null when data/procurement/ is not available at ingest time.
  procurementIndexGeneratedAt: string | null;
  entries: MinistryProcurement[];
}

// ---------------------------------------------------------------------------
// Per-ministry rollup — data/budget/ministries/<nodeId>.json
// ---------------------------------------------------------------------------

// A self-contained slice for the ministry detail screen: everything that
// screen renders for one spending unit, so it fetches ONE small file instead
// of every year's whole-corpus reconciliation + the program registry.
//
// `revenue`/`expenditure`/`balance` carry the State Budget Law's appropriation
// (planned). `execution`, when present, adds the уточнен план (amended) and
// the отчет (executed) from the year-end execution report; null for any
// unit/year without an ingested execution report.
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
    execution: MinistrySeriesExecution | null; // null when only law data exists
  }>;
}

export interface MinistryRollup {
  nodeId: string; // admin classification node id (the route param)
  nameBg: string;
  nameEn: string;
  eik: string | null; // procurement awarder EIK, when matched
  years: MinistryRollupYear[]; // ascending by fiscalYear
  procurement: MinistryProcurement | null;
}

// Provenance stamp carried by every fact / observation back to documents.json.
export interface BudgetSourceRef {
  documentId: string;
  sheet?: string; // Excel sheet / PDF annex id / egov resource uuid
  page?: number;
  row?: number;
  rowLabel?: string;
}

// ---------------------------------------------------------------------------
// Index — data/budget/index.json
// ---------------------------------------------------------------------------

export interface BudgetYearCoverage {
  fiscalYear: number;
  stages: BudgetStage[]; // which of law/amendment/execution are on disk
  kfpPeriods: string[]; // periods of КФП observations for this year
  // Per-dimension reconciliation completeness — populated Phase 2+.
  dimensions?: Partial<
    Record<"admin" | "functional" | "economic" | "program", boolean>
  >;
}

export interface BudgetIndex {
  generatedAt: string;
  lastIngest: string;
  country: "BG";
  // КФП period range present on disk.
  kfp: {
    cadences: KfpCadence[];
    firstPeriod: string | null;
    lastPeriod: string | null;
    observationCount: number;
  };
  years: BudgetYearCoverage[];
  // Per-fiscal-year full-year roll-ups — the election-scoped dashboard reads
  // these directly instead of re-deriving from the observation series.
  fiscalYears: FiscalYearSummary[];
  documentCount: number;
}
