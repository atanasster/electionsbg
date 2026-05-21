// Types for the ИСУН EU-funds beneficiary dataset (data/funds/).
//
// Source: the public "Бенефициенти" report of ИСУН 2020 (2020.eufunds.bg) —
// one row per organisation that has signed at least one EU-funds contract,
// with all-time rollup totals. Amounts are in EUR.

export interface FundsBeneficiary {
  // 9-digit canonical EIK/BULSTAT parsed from the org-name cell, or null when
  // the leading token is absent or not a 9/13-digit company id (10-digit
  // tokens are dropped — they may be a personal ЕГН).
  eik: string | null;
  // Organisation name, with the leading EIK token stripped.
  name: string;
  // Тип на организацията — Компания / Учебно заведение / Държавна администрация…
  orgType: string;
  // Вид на организацията — ООД / ЕООД / АД / Детска градина…
  orgKind: string;
  // Форма на организацията — Частно правна / Публично правна.
  orgForm: string;
  // Брой сключени договори.
  contractCount: number;
  // Договорени средства (EUR).
  contractedEur: number;
  // Реално изплатени суми (EUR).
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
  // True when the beneficiary is a company a sitting/former MP has a declared
  // stake or management role in (see the cross-reference below).
  mpTied: boolean;
  mpIds: number[];
}

// One declared relation between an MP and a beneficiary company — a Commerce
// Registry management role or a Court-of-Audit declared ownership stake.
export interface FundsMpRelation {
  kind: string; // "stake" | "director" | "manager" | "actual_owner" | …
  isCurrent?: boolean;
  confidence?: "high" | "medium" | "low";
  shareSize?: string;
  valueEur?: number;
  fiscalYear?: number;
  declarationYear?: number;
}

// One (MP, beneficiary) pair: an MP-connected company that received EU funds.
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
  total: number; // (MP, beneficiary) pair count
  mpCount: number;
  beneficiaryCount: number;
  contractedEur: number;
  paidEur: number;
  entries: FundsMpConnected[];
}

// At-a-glance cross-reference summary carried on the index.
export interface FundsCrossRefSummary {
  generatedAt: string;
  mpCount: number;
  beneficiaryCount: number;
  pairCount: number;
  contractedEur: number;
  paidEur: number;
}

export interface FundsIndex {
  generatedAt: string;
  lastIngest: string;
  source: { label: string; url: string };
  totals: {
    beneficiaries: number;
    contractCount: number;
    contractedEur: number;
    paidEur: number;
    // How many beneficiary rows carried a parseable 9-digit EIK — the join
    // surface for a future MP cross-reference.
    withEik: number;
  };
  // Aggregates by organisation type and by public-/private-law form.
  byOrgType: FundsBreakdownRow[];
  byOrgForm: FundsBreakdownRow[];
  // Top beneficiaries by contracted / actually-paid funds.
  topByContracted: FundsTopRow[];
  topByPaid: FundsTopRow[];
  // MP cross-reference summary — present only when companies-index.json was
  // available at ingest time. The full payload is derived/mp_connected.json.
  crossReference?: FundsCrossRefSummary;
  // beneficiaries/<shard>.json file keys (EIK last digit, or "_x").
  shards: string[];
}
