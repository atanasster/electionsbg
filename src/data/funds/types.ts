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
  // How the money was attributed to places. "muni-share-even-split": a
  // contract whose declared location names N общини contributes 1/N of its
  // value to each, so these are attributed euros rather than raw contract
  // values. Optional — payloads written before the marker existed lack it.
  basis?: "muni-share-even-split";
  muniCount: number;
  munis: FundsProjectsMuniMapRow[];
}

// Single-contract record — one row of the ИСУН Project register with its
// resolved location attached. Backed by
// /funds/projects/by-contract/{contractNumber}.json (one file per signed
// contract, ~1-2 KB each). Mirrors ResolvedFundsProject in
// scripts/funds/projects_types.ts.
export interface FundsProjectsContractFile {
  programCode: string;
  programName: string;
  beneficiaryEik: string | null;
  beneficiaryName: string;
  orgType: string;
  orgKind: string;
  orgForm: string;
  hqAddress: string;
  locationRaw: string;
  contractNumber: string;
  title: string;
  totalEur: number;
  grantEur: number;
  ownCofinanceEur: number;
  paidEur: number;
  durationMonths: number;
  status: string;
  location: {
    kind: "settlement" | "muni" | "region" | "national" | "unresolved";
    raw: string;
    ekatte?: string;
    munis?: string[];
    oblasts?: string[];
    nutsCodes?: string[];
    ambiguousCandidates?: string[];
  };
}

// Slim drill-down payload for a single programme. Backed by
// /funds/projects/by-program/{code}-summary.json — see
// scripts/funds/projects_types.ts for the source of truth.
export interface FundsProjectsProgramSummaryFile {
  programCode: string;
  programName: string;
  rollup: FundsProjectsRollup;
  statusBreakdown: Array<{
    status: string;
    rollup: FundsProjectsRollup;
  }>;
  byLocationKind: {
    settlement: number;
    muni: number;
    region: number;
    national: number;
    unresolved: number;
  };
  topContracts: Array<{
    contractNumber: string;
    title: string;
    totalEur: number;
    paidEur: number;
    status: string;
    beneficiaryEik: string | null;
    beneficiaryName: string;
    locationRaw: string;
    locationMunis: string[] | null;
  }>;
  topBeneficiaries: Array<{
    beneficiaryEik: string | null;
    beneficiaryName: string;
    orgType: string;
    contractCount: number;
    totalEur: number;
    paidEur: number;
  }>;
  topMunis: Array<{
    muni: string;
    oblast: string | null;
    contractCount: number;
    totalEur: number;
    paidEur: number;
  }>;
}

// Slim summary for a single ИСУН procedure — the grain between a programme and
// a contract (`BG16RFOP002-2.089`). Backs /funds/procedure/{code}, served as
// fund_payloads(kind='procedure'). See scripts/funds/projects_types.ts for the
// source of truth.
export interface FundsProjectsProcedureSummaryFile {
  procedureCode: string;
  // Null when the procedure's contracts do not share one title, so no scheme
  // name can be honestly derived — the page then leads with the code.
  procedureName: string | null;
  programCode: string;
  programName: string;
  rollup: FundsProjectsRollup;
  statusBreakdown: Array<{
    status: string;
    rollup: FundsProjectsRollup;
  }>;
  topBeneficiaries: FundsProjectsProgramSummaryFile["topBeneficiaries"];
  topContracts: FundsProjectsProgramSummaryFile["topContracts"];
  topMunis: FundsProjectsProgramSummaryFile["topMunis"];
}

// Slim "tile-ready" summary for a single place. Backed by
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
  // The contract's full value. On a муни tile this sits next to a
  // share-weighted rollup, so it can legitimately exceed the муни's own
  // total — muniCount says why.
  totalEur: number;
  paidEur: number;
  status: string;
  programCode: string;
  programName: string;
  beneficiaryEik: string | null;
  beneficiaryName: string;
  // Only set when the contract's declared location names several общини and
  // its money was split evenly between them.
  muniCount?: number;
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

/** One municipality's per-capita EU money with the Interreg arm counted
 * (migration 139, /api/db/funds-muni-combined).
 *
 * TWO RANKS, and they are different quantities. `oblastRank` is the cohort the
 * ИСУН summary already publishes and MyAreaProjectsMapTile already renders
 * ("място N от 13 общини в областта"); `rank` is national over 256. A surface
 * that swaps one for the other changes what its number means with nothing
 * failing, so both carry their scope in the name.
 *
 * The two money arms are never collapsed into one: ИСУН money is *attributed*
 * (a contract naming N общини contributes 1/N to each), Interreg money is a
 * partner's own published budget at one address. */
export interface FundsMuniCombined {
  obshtina: string;
  population: number;
  isunEur: number;
  interregEur: number;
  totalEur: number;
  interregPartnerCount: number;
  interregOperationCount: number;
  perCapitaEur: number;
  /** The same figure with the Interreg arm removed — what the site showed
   * before, kept so a surface can state the movement rather than assert it. */
  perCapitaEurIsun: number;
  rank: number;
  rankBefore: number;
  rankDelta: number;
  cohortSize: number;
  oblastCode: string | null;
  oblastRank: number;
  oblastRankBefore: number;
  oblastRankDelta: number;
  oblastCohortSize: number;
}

/** The national Interreg picture (migration 138, /api/db/interreg-overview). */
export interface InterregOverview {
  budgetEur: number;
  partnerCount: number;
  operationCount: number;
  programmeCount: number;
  /** Partner rows resolved to an EKATTE. The rest are honestly unplaced. */
  placedCount: number;
  /** Rows whose programme published no budget: they count in `partnerCount` and
   *  contribute ZERO euros, so the two must never be divided by each other. */
  unpublishedPartnerCount: number;
  /** THE headline caveat, not a detail. keep.eu's national-id field exists only
   *  in the 2021-2027 template, so `linkedCount` is 0 for 2014-2020 by
   *  construction — roughly two thirds of this money is attributable to a place
   *  but never to a company. */
  periods: Record<
    string,
    {
      budgetEur: number;
      partnerCount: number;
      operationCount: number;
      linkedCount: number;
    }
  >;
  programmes: {
    code: string;
    nameBg: string | null;
    nameEn: string | null;
    period: string;
    budgetEur: number;
    partnerCount: number;
    operationCount: number;
  }[];
}

/** The combined per-capita leaderboard (/api/db/funds-muni-rank). */
export interface FundsMuniRank {
  cohortSize: number;
  movedCount: number;
  withInterregCount: number;
  /** What the ranking does NOT cover on the INTERREG arm, by reason —
   *  `outsideCohort` carries Столична община's €88.7m, `ranked` is the covered
   *  bucket rather than an exclusion. Render it or the table implies coverage it
   *  does not have. */
  excluded: Record<string, { rows: number; eur: number }>;
  /** The ИСУН money outside the SAME cohort — €6.56bn, two orders of magnitude
   *  larger, because Sofia alone holds €5.52bn and has no per-capita figure on
   *  either arm. Any caption naming both sources must print both numbers. */
  excludedIsunEur: number;
  munis: {
    obshtina: string;
    population: number;
    isunEur: number;
    interregEur: number;
    totalEur: number;
    perCapitaEur: number;
    rank: number;
    rankBefore: number;
    rankDelta: number;
  }[];
}

/** One Interreg operation with its full partnership
 *  (migration 138, /api/db/interreg-operation).
 *
 *  THE ONE SURFACE WHERE THE OPERATION TOTAL IS THE HEADLINE. Everywhere else
 *  `totalBudgetEur` is forbidden inside an aggregate — summing it per place puts
 *  ~4x the true money on a municipality. Here the subject IS the whole
 *  cross-border project, so it is the honest figure, and `bgBudgetEur` travels
 *  beside it so neither stands in for the other. */
export interface InterregOperationDetail {
  keepId: number;
  operationId: string | null;
  programmeCode: string;
  programmeBg: string | null;
  programmeEn: string | null;
  period: string;
  titleEn: string;
  titleBg: string | null;
  /** Which language `titleEn` is actually in. keep.eu publishes English only
   *  and its own detection files two operations under mt/it, so a BG page says
   *  the title is foreign rather than implying a translation exists. */
  titleLang: string | null;
  summaryEn: string | null;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  totalBudgetEur: number | null;
  euFundingEur: number | null;
  coFinancingRate: number | null;
  partnerCount: number | null;
  countries: string[] | null;
  bgBudgetEur: number;
  bgPartnerCount: number;
  partners: {
    seq: number;
    name: string;
    nameEn: string | null;
    country: string;
    isLead: boolean;
    eik: string | null;
    orgType: string | null;
    budgetEur: number | null;
    budgetBasis: string;
    ekatte: string | null;
    obshtina: string | null;
    placeBasis: string | null;
    locationRaw: string | null;
  }[];
}
