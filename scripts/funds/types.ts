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
  // beneficiaries/<shard>.json file keys (EIK last digit, or "_x").
  shards: string[];
}
