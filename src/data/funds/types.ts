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
