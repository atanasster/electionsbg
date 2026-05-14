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

export interface KfpSnapshotLine {
  labelBg: string;
  labelEn: string;
  planned: Money | null;
  executed: Money | null;
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
  latestSnapshot: KfpSnapshot | null;
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

export interface BudgetYearCoverage {
  fiscalYear: number;
  stages: Array<"law" | "amendment" | "execution">;
  kfpPeriods: string[];
  dimensions?: Partial<
    Record<"admin" | "functional" | "economic" | "program", boolean>
  >;
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
}
