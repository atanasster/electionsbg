// SPA-side types for the EU-funds (ИСУН) data files under /funds/.
// Mirrors the shapes written by scripts/funds/.

// One row of the sharded beneficiary corpus (funds/beneficiaries/<k>.json) —
// an organisation that has signed at least one EU-funds contract, with
// all-time rollup totals. Amounts are in EUR.
export interface FundsBeneficiary {
  eik: string | null;
  name: string;
  orgType: string;
  orgKind: string;
  orgForm: string;
  contractCount: number;
  contractedEur: number;
  paidEur: number;
}

export interface FundsBreakdownRow {
  key: string;
  beneficiaries: number;
  contractCount: number;
  contractedEur: number;
  paidEur: number;
}

export interface FundsTopRow {
  eik: string | null;
  name: string;
  orgType: string;
  contractCount: number;
  contractedEur: number;
  paidEur: number;
  mpTied: boolean;
  mpIds: number[];
}

export interface FundsCrossRefSummary {
  generatedAt: string;
  mpCount: number;
  beneficiaryCount: number;
  pairCount: number;
  contractedEur: number;
  paidEur: number;
}

export interface FundsIndexFile {
  generatedAt: string;
  lastIngest: string;
  source: { label: string; url: string };
  totals: {
    beneficiaries: number;
    contractCount: number;
    contractedEur: number;
    paidEur: number;
    withEik: number;
  };
  byOrgType: FundsBreakdownRow[];
  byOrgForm: FundsBreakdownRow[];
  topByContracted: FundsTopRow[];
  crossReference?: FundsCrossRefSummary;
  shards: string[];
}

// One declared MP↔beneficiary relation — a Commerce Registry management role
// or a Court-of-Audit declared ownership stake.
export interface FundsMpRelation {
  kind: string;
  isCurrent?: boolean;
  confidence?: "high" | "medium" | "low";
  shareSize?: string;
  valueEur?: number;
  fiscalYear?: number;
  declarationYear?: number;
}

export interface FundsMpConnected {
  mpId: number;
  mpName: string;
  beneficiaryEik: string;
  beneficiaryName: string;
  orgType: string;
  relations: FundsMpRelation[];
  contractCount: number;
  contractedEur: number;
  paidEur: number;
}

export interface FundsMpConnectedFile {
  generatedAt: string;
  total: number;
  mpCount: number;
  beneficiaryCount: number;
  contractedEur: number;
  paidEur: number;
  entries: FundsMpConnected[];
}

// Curated journalism cross-reference (funds/confirmed.json) — beneficiaries a
// published investigation named, whose grant the ИСУН register corroborates.
export interface FundsConfirmedSource {
  outlet: string;
  title: string;
  url: string;
}

export interface FundsConfirmedBeneficiary {
  name: string;
  eik: string;
  contractedEur: number;
  contractedBgn: number;
  paidEur: number;
  contractCount: number;
}

export interface FundsConfirmedCase {
  id: string;
  person: string;
  programme: string;
  round?: string;
  beneficiaries: FundsConfirmedBeneficiary[];
  claim: {
    reportedGrantBgn?: number | null;
    reportedCoFinancingBgn?: number | null;
    reportedTotalBgn?: number | null;
    reportedApprox?: string;
    reportedGrantPerCompanyBgn?: number;
    summary: string;
  };
  sources: FundsConfirmedSource[];
  match: string;
  verification: string;
  status: string;
}

export interface FundsConfirmedFile {
  generatedAt: string;
  description: string;
  measure: {
    name: string;
    fund: string;
    note: string;
    officialList: string;
  };
  cases: FundsConfirmedCase[];
}

// Contract-level corpus index. Backed by /funds/projects/index.json — the
// header summary of the projects ingest (one row per signed EU-funds
// contract, ~80k rows). Smaller than the beneficiary FundsIndexFile and
// carries dimensions the beneficiary rollup doesn't have: programme,
// status, and the resolved-location histogram.
export interface FundsProjectsIndexFile {
  generatedAt: string;
  lastIngest: string;
  source: { label: string; url: string };
  totals: {
    contractCount: number;
    beneficiaryCount: number;
    totalEur: number;
    grantEur: number;
    paidEur: number;
    byLocationKind: {
      settlement: number;
      muni: number;
      region: number;
      national: number;
      unresolved: number;
    };
    withEik: number;
  };
  byProgram: Array<{
    programCode: string;
    programName: string;
    rollup: FundsProjectsRollup;
  }>;
  byStatus: Array<{
    status: string;
    rollup: FundsProjectsRollup;
  }>;
  muniShards: string[];
  programShards: string[];
  ekatteShardCount: number;
  eikShardCount: number;
  multiLocationCount: number;
}

// One муни row in the contract-level choropleth-map data file. Backed by
// data/funds/projects/muni-map.json — denormalised so the /funds map tile
// renders without 274 fan-out fetches. The synthetic "SOF00" entry
// aggregates всички Sofia obshtinas (S22 + S23xx + S24xx + S25xx); per-capita
// is intentionally null for it because ГРАО doesn't carry the Sofia city
// EKATTE.
export interface FundsProjectsMuniMapRow {
  muni: string;
  oblast: string | null;
  contractCount: number;
  totalEur: number;
  paidEur: number;
  perCapitaEur: number | null;
  perCapitaRank: number | null;
  cohortSize: number | null;
  population: number | null;
}

export interface FundsProjectsMuniMapFile {
  generatedAt: string;
  muniCount: number;
  munis: FundsProjectsMuniMapRow[];
}

// Slim "tile-ready" summary for a single place. Backed by
// funds/projects/by-ekatte/{ekatte}-summary.json and
// funds/projects/by-muni/{obshtina}-summary.json — see
// scripts/funds/projects_types.ts for the source of truth.
export interface FundsProjectsRollup {
  contractCount: number;
  beneficiaryCount: number;
  totalEur: number;
  grantEur: number;
  paidEur: number;
}

export interface FundsProjectsTopContract {
  contractNumber: string;
  title: string;
  totalEur: number;
  paidEur: number;
  status: string;
  programCode: string;
  programName: string;
  beneficiaryEik: string | null;
  beneficiaryName: string;
}

export interface FundsProjectsTopProgram {
  programCode: string;
  programName: string;
  rollup: FundsProjectsRollup;
}

export interface FundsProjectsSummaryFile {
  kind: "ekatte" | "muni";
  placeId: string;
  rollup: FundsProjectsRollup;
  topContracts: FundsProjectsTopContract[];
  topPrograms: FundsProjectsTopProgram[];
  perCapitaEur: number | null;
  population: number | null;
  perCapitaRank: number | null;
  cohortSize: number | null;
  oblastCode: string | null;
}
