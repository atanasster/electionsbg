// Shapes for the АОП (Agency for Public Procurement) ingest. The upstream
// data is OCDS-standard JSON (Open Contracting Data Standard) published in
// fortnightly bundles on data.egov.bg. We normalize each release that has a
// signed contract or award into a flat Contract record, then roll up by
// contractor and awarder EIK.
//
// Why flat? OCDS releases nest awards × suppliers × contracts deeply, and
// downstream consumers (the SPA, the MP cross-reference) need one row per
// (contract, supplier) tuple — there's no upside to preserving the nest.

// Tag values from OCDS that we ingest. Pure-tender notices (no award yet) are
// skipped — they have no money and no contractor.
export type ContractTag = "award" | "contract" | "contractAmendment";

export interface Contract {
  // Stable URL slug. Derived from (releaseId, contractId, contractorEik, tag)
  // via sha256 truncated to 12 hex chars — short enough for a clean URL,
  // long enough that collisions are astronomical given our row count
  // (~50k/year × N years).
  key: string;
  // OCDS identifiers. ocid is unique per procurement procedure; multiple
  // releases (tender → award → contract → amendment) share the same ocid.
  // releaseId is unique per event; contractId is the OCDS contract.id within
  // the release (only set when tag === "contract" or "contractAmendment").
  ocid: string;
  releaseId: string;
  contractId?: string;
  tag: ContractTag;

  // When. `date` is the release timestamp; `dateSigned` is the actual contract
  // signing date when published (often earlier than `date` for retro-published
  // contracts).
  date: string; // ISO YYYY-MM-DD (truncated from release.date)
  dateSigned?: string;

  // Awarding side (buyer). EIK is 9-digit canonical; fall back to scheme/ref
  // when missing.
  awarderEik: string;
  awarderName: string;
  awarderRegion?: string; // NUTS code (BG411, …) — populated when on the party
  /** Awarder HQ locality (free text, e.g. "гр. София"). Captured from
   *  parties[].address at normalization. Used by the EKATTE resolver in
   *  the rollup builder — see scripts/procurement/resolve_ekatte.ts. */
  awarderLocality?: string;
  /** Awarder HQ postal code (4-digit BG). 100% populated in the 2026
   *  bundles; primary key for the EKATTE resolver. */
  awarderPostal?: string;
  awarderStreet?: string;

  // Contractor side (supplier). EIK is 9-digit canonical; eikFull preserves
  // the 13-digit branch form when the upstream provided it.
  contractorEik: string;
  contractorEikFull?: string;
  contractorName: string;

  // Money. The native amount + currency are preserved as-is — the UI footnotes
  // the original ("originally 5 000 лв"). `amountEur` is the euro-converted
  // value used for every aggregate and display figure: set for BGN/EUR rows
  // (BGN via the locked 1.95583 peg), undefined for the rare USD/GBP/CHF rows
  // which the UI shows natively. See src/lib/currency.ts.
  amount?: number;
  currency?: string;
  amountEur?: number;

  // Subject.
  title: string;
  cpv?: string; // First CPV code on the related lot's item
  procurementMethod?: string; // open / limited / selective
  category?: string; // works / goods / services
  /** OCDS `tender.procurementMethodRationale` — the buyer's stated reason for
   *  using a non-open procedure (often "договаряне без обявление" / "single
   *  source"). When present, used by the risk-score to flag negotiated
   *  procedures explicitly. */
  procurementMethodRationale?: string;
  /** OCDS `tender.numberOfTenderers` — count of operators who submitted a bid
   *  (some publishers populate `numberOfBids` instead; we prefer tenderers
   *  when both are present). 1 = single-bidder red flag. */
  numberOfTenderers?: number;
  /** EU co-financing flag + programme name. Only the ЦАИС ЕОП flat feed carries
   *  these uniformly; backfilled onto OCDS/legacy rows by eop_field_map.ts via
   *  the (buyer, supplier, date) content-join. Absent ⇒ unknown, not "no". */
  euFunded?: boolean;
  euProgram?: string;
  /** Tender open window. Both ISO YYYY-MM-DD when present. Used to derive a
   *  "short deadline" signal: if `tenderPeriodEndDate - tenderPeriodStartDate`
   *  is below a configurable threshold (default 14 days for open procedures
   *  per EU 2014/24/EU Art. 27), the contract is flagged. */
  tenderPeriodStartDate?: string;
  tenderPeriodEndDate?: string;

  // Source. bundleUuid traces back to which fortnight bundle this came from;
  // sourceUrl is the data.egov.bg release link (best we have — there's no
  // per-contract permalink at АОП).
  bundleUuid: string;
  sourceUrl: string;
}

export interface BundleEntry {
  // The dataset UUID on data.egov.bg (e.g. /data/view/<uuid>).
  datasetUuid: string;
  // The resource UUID inside the dataset (1 resource per dataset for АОП).
  // This is what feeds /resource/download/<uuid>/json.
  resourceUuid: string;
  // Period covered, parsed from the dataset label
  // "...през периода от DD-MM-YYYY до DD-MM-YYYY...".
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  // Raw label text — kept for debugging / display.
  label: string;
}

export interface BundlesIndex {
  fetchedAt: string;
  total: number;
  entries: BundleEntry[]; // sorted newest-first by periodEnd
}

// Slim contract row embedded in per-entity rollups. Carries only the fields
// the dashboard "top contracts" tiles render — avoids the 4 MB
// contractor_contracts/<eik>.json fetch when all we want is a 10-row preview.
// The full row (title, cpv, procurementMethod, dateSigned, etc.) is still
// available in contractor_contracts/<eik>.json / awarder_contracts/<eik>.json
// for the /contracts subpages.
export interface RollupContractRow {
  key: string;
  ocid: string;
  date: string;
  /** OCDS notice type — "award" (announced/обявена), "contract"
   *  (awarded/възложена), "contractAmendment" (annex/анекс). Lets the place
   *  dashboards + the alert feed distinguish the notice kind instead of
   *  merging them into one "procurement" stream. Optional so legacy rollups
   *  that predate this field still parse. */
  tag?: ContractTag;
  amount?: number;
  currency?: string;
  amountEur?: number;
  // The "other side" of the relation — embedded so the tile can render a link.
  // On a ContractorRollup these point to the awarder; on an AwarderRollup
  // these point to the contractor.
  partyEik: string;
  partyName: string;
  // Source-resolution fields used by resolveContractSource() on the SPA.
  bundleUuid: string;
  sourceUrl: string;
}

export interface ContractorRollup {
  eik: string;
  name: string;
  // Euro total (EUR + BGN folded via the locked peg). `totalOther` carries
  // the rare USD/GBP/CHF remainder we keep native. See src/lib/currency.ts.
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
  awardCount: number;
  // Distinct awarders that paid this contractor (true count; byAwarder below is
  // capped at a top-N for file size).
  awarderCount: number;
  // Top awarders, sorted by euro total.
  byAwarder: Array<{
    eik: string;
    name: string;
    totalEur: number;
    totalOther: Record<string, number>;
    contractCount: number;
  }>;
  // Per-year breakdown.
  byYear: Array<{
    year: string;
    totalEur: number;
    totalOther: Record<string, number>;
    contractCount: number;
  }>;
  // Top contracts by amount (descending). Drives the "Top contracts" tile on
  // /company/:eik without forcing a 4 MB contractor_contracts/<eik>.json fetch.
  // partyEik/partyName point to the awarder for this row.
  topContracts: RollupContractRow[];
  generatedAt: string;
}

/** Resolved geographic + tier metadata attached to each awarder rollup so
 *  the per-settlement aggregator can group local-tier buyers by EKATTE and
 *  separate central/national procurement into its own rollup.
 *
 *  Source: scripts/procurement/resolve_ekatte.ts (postal-primary →
 *  name+province → name-only) and scripts/procurement/awarder_tier.ts
 *  (heuristic-by-name + curated EIK overrides). See
 *  [[project_procurement_geo]] for the methodology note. */
export interface AwarderGeo {
  ekatte: string;
  /** Confidence band emitted by the resolver — strongest match wins. */
  confidence:
    | "postal+name+province"
    | "postal+name"
    | "postal_only"
    | "name+province"
    | "name_only"
    // Curated identity override (scripts/procurement/awarder_identity.ts) — a
    // hand-set HQ seat that wins over any row-derived geo.
    | "manual";
  /** Awarder tier — see scripts/procurement/awarder_tier.ts for the full
   *  list. `isLocalHQ` is derived from the LOCAL_TIERS set so consumers
   *  don't need to keep the membership rule in sync. */
  tier:
    | "municipal"
    | "school"
    | "hospital"
    | "university"
    | "forestry"
    | "regional_gov"
    | "utility"
    | "central_ministry"
    | "central_agency"
    | "national_state_co"
    | "other";
  /** true when tier ∈ LOCAL_TIERS (municipality / school / hospital /
   *  university / forestry / regional_gov / utility). Central/national
   *  buyers procure nationwide from a Sofia HQ so their EKATTE is *not*
   *  a meaningful proxy for where the contract was spent. */
  isLocalHQ: boolean;
}

/** Snapshot of buyer.address as captured during normalization. Stored on
 *  the rollup (not on each contract) since a buyer's HQ rarely changes
 *  inside the lifetime of a procurement record. */
export interface AwarderAddress {
  locality?: string;
  postal?: string;
  street?: string;
}

/** Human-readable seat of the awarding body — settlement + município + oblast.
 *  Resolved by scripts/procurement/enrich_awarder_seats.ts, either from the
 *  rollup's own `geo.ekatte` (when geo-resolved) or, for legacy-CSV-only
 *  awarders that never got a geo block, from the settlement marker embedded in
 *  their contract-name variants (e.g. `… с. Рибново`). Names are inlined so the
 *  client renders the seat without loading the EKATTE registry. */
export interface AwarderSeat {
  ekatte: string;
  settlement: string;
  municipality: string;
  oblast: string;
  isVillage: boolean;
  /** Provenance: "geo" = from the resolved buyer-HQ EKATTE; "name" = parsed
   *  from a unique settlement name in the awarder's contract-name variants. */
  source: "geo" | "name";
}

export interface AwarderRollup {
  eik: string;
  name: string;
  region?: string;
  /** Address fields captured from `parties[].address` at normalization time.
   *  Sourced exclusively from OCDS bundles; awarders that haven't appeared
   *  in a 2026+ bundle (legacy-CSV-only) have no address. */
  address?: AwarderAddress;
  /** Resolved EKATTE + tier. Absent when address is missing or the
   *  resolver couldn't pick a single settlement. */
  geo?: AwarderGeo;
  /** Human-readable seat (settlement/município/oblast). Stamped offline by
   *  scripts/procurement/enrich_awarder_seats.ts; absent until that runs. */
  seat?: AwarderSeat;
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
  awardCount: number;
  // Distinct contractors this awarder has paid (true count; byContractor below
  // is capped at a top-N for file size).
  contractorCount: number;
  // Top contractors this awarder has paid.
  byContractor: Array<{
    eik: string;
    name: string;
    totalEur: number;
    totalOther: Record<string, number>;
    contractCount: number;
  }>;
  byYear: Array<{
    year: string;
    totalEur: number;
    totalOther: Record<string, number>;
    contractCount: number;
  }>;
  // Top contracts by amount (descending). Drives the "Top contracts" tile on
  // /awarder/:eik without forcing a 4 MB awarder_contracts/<eik>.json fetch.
  // partyEik/partyName point to the contractor for this row.
  topContracts: RollupContractRow[];
  generatedAt: string;
}

export interface ProcurementIndex {
  generatedAt: string;
  lastIngest: string;
  years: string[];
  months: string[]; // YYYY-MM, sorted ascending
  totals: {
    contracts: number;
    awards: number;
    amendments: number;
    contractorCount: number;
    awarderCount: number;
    totalEur: number;
    totalOther: Record<string, number>;
  };
  // Last-seen fortnight bundles, mirrors bundles.json. Useful for "what
  // periods does the SPA have data for" without a second fetch.
  periods: Array<{
    bundleUuid: string;
    periodStart: string;
    periodEnd: string;
  }>;
  // MP cross-reference summary. Populated when companies-index.json is
  // available; null/zero when the skill ran without it.
  crossReference?: {
    generatedAt: string;
    mpCount: number;
    contractorCount: number;
    pairCount: number;
    totalEur: number;
    totalOther: Record<string, number>;
  };
  // Officials (non-MP political class) cross-reference summary. De-duplicated
  // by contractor EIK. Populated from data/officials/derived/company_links.json.
  officialsCrossReference?: {
    generatedAt: string;
    officialCount: number;
    contractorCount: number;
    pairCount: number;
    totalEur: number;
  };
}

// Relationship kind on the MP↔company edge. "stake" comes from MP property
// declarations on register.cacbg.bg; the others come from Commerce Registry
// (TR) filings. Preserved in the cross-reference output so the UI can render
// the right phrasing ("MP X is a partner in Y" vs "MP X declared a stake in Y").
export type MpCompanyRelationKind =
  | "partner"
  | "manager"
  | "branch_manager"
  | "director"
  | "actual_owner"
  | "representative"
  | "liquidator"
  | "procurator"
  | "stake";

export interface MpCompanyRelation {
  kind: MpCompanyRelationKind;
  // For TR-role kinds. "current" reflects whether the role is still active.
  isCurrent?: boolean;
  confidence?: "high" | "medium" | "low";
  // For "stake" kind. Multiple stakes can exist (per-year filings); we record
  // the most recent fiscalYear's data.
  shareSize?: string;
  valueEur?: number;
  fiscalYear?: number;
  declarationYear?: number;
}

export interface MpConnectedContractor {
  mpId: number;
  mpName: string;
  contractorEik: string;
  contractorName: string;
  relations: MpCompanyRelation[];
  // Rollup of all (award, contract, amendment) rows where this contractor
  // appears, regardless of awarding body.
  totalEur: number;
  totalOther: Record<string, number>;
  // contractCount lumps signed contracts + amendments together. They share
  // amount semantics (each amendment carries the post-amendment value); the
  // UI can split them later by re-reading the underlying month-shards if it
  // becomes journalistically relevant.
  contractCount: number;
  awardCount: number;
  byYear: Array<{
    year: string;
    totalEur: number;
    totalOther: Record<string, number>;
    contractCount: number;
  }>;
  // Top awarding bodies for this contractor — same shape as ContractorRollup
  // but bounded by the contractor's own contracts, so we can render the per-MP
  // tile without fetching the full contractor file.
  topAwarders: Array<{
    eik: string;
    name: string;
    totalEur: number;
    totalOther: Record<string, number>;
    contractCount: number;
  }>;
}

export interface MpConnectedFile {
  generatedAt: string;
  total: number;
  entries: MpConnectedContractor[];
}

export interface TopContractorEntry {
  eik: string;
  name: string;
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
  awardCount: number;
  mpTied: boolean;
  // When mpTied, the list of MPs linked to this contractor. Empty otherwise.
  mpIds: number[];
}

export interface TopContractorsFile {
  generatedAt: string;
  total: number;
  // Top N by euro total. The SPA's /procurement page reads this directly.
  entries: TopContractorEntry[];
}

// Snapshot of the АОП "Стопански субекти с нарушения" (debarred-suppliers)
// register, scraped from https://www2.aop.bg. The source removes expired rows
// automatically, so this file is *merge-on-write*: every entry we have ever
// seen is preserved, with the latest scrape's `seenAt` so the SPA can show
// "still on the active list" vs. "past entry".
export interface DebarredEntry {
  /** Entity name as published, untouched whitespace-trimmed. */
  name: string;
  /** Folded form for cross-referencing against contractor names: upper-cased
   * Bulgarian, suffixes (ООД/ЕООД/АД/…) stripped, multi-space collapsed. */
  nameNormalized: string;
  /** ISO date the listing was published (YYYY-MM-DD). */
  publishedAt: string;
  /** ISO date until which the debarment applies (YYYY-MM-DD). Parsed from the
   * "Срок" column on the source page. */
  debarredUntil: string;
  /** PDF link to the КЗК decision summary on www2.aop.bg, when present. */
  detailsUrl: string | null;
  /** First date this entry was observed by our scraper (so historical rows
   * persist even after the upstream registry purges them). */
  firstSeenAt: string;
  /** Last date this entry was confirmed on the live page. When less than
   * `debarredUntil`, the SPA treats the row as historical. */
  lastSeenAt: string;
}

export interface DebarredFile {
  generatedAt: string;
  source: string;
  total: number;
  entries: DebarredEntry[];
}

// Awarder→contractor concentration: high share of a buyer's lifetime spending
// concentrated on one contractor. Only pairs above the threshold are emitted;
// the long tail is irrelevant for risk scoring and would inflate the file.
export interface AwarderConcentrationEntry {
  awarderEik: string;
  awarderName: string;
  contractorEik: string;
  contractorName: string;
  /** 0..1. Share of awarder's total spending going to this contractor. */
  sharePct: number;
  awarderTotalEur: number;
  pairTotalEur: number;
  contractCount: number;
}

export interface AwarderConcentrationFile {
  generatedAt: string;
  /** Minimum share (0..1) for a pair to be emitted. */
  thresholdPct: number;
  /** Minimum awarder spending (€) for a pair to be considered; below this any
   * share is statistically noise. */
  minAwarderTotalEur: number;
  total: number;
  entries: AwarderConcentrationEntry[];
}

/** Per-settlement shard — data/procurement/by_settlement/{ekatte}.json.
 *  Aggregates every awarder whose tier ∈ LOCAL_TIERS pinned to this
 *  EKATTE. Central/national procurement is rolled up separately into
 *  by_settlement/_national.json (the SPA renders a distinct card so the
 *  user doesn't read a giant Sofia bubble as a Sofia outcome). */
export interface SettlementProcurementFile {
  ekatte: string;
  name: string;
  province: string;
  obshtina: string;
  generatedAt: string;
  contractCount: number;
  awardCount: number;
  totalEur: number;
  totalOther: Record<string, number>;
  /** Local-tier awarders that resolve to this settlement, sorted by total
   *  euro descending. */
  awarders: Array<{
    eik: string;
    name: string;
    tier: AwarderGeo["tier"];
    totalEur: number;
    totalOther: Record<string, number>;
    contractCount: number;
    awardCount: number;
  }>;
  /** Top contracts in this settlement (by amount, descending). Slim row;
   *  full details live on /awarder/:eik and /contract/:id. */
  topContracts: RollupContractRow[];
  /** Annual totals across all awarders in this settlement. */
  byYear: Array<{
    year: string;
    totalEur: number;
    totalOther: Record<string, number>;
    contractCount: number;
  }>;
}

/** Landing-page index — data/procurement/by_settlement/index.json. Lists
 *  every settlement with at least one local-tier contract, plus the
 *  national rollup as a sibling card. Sortable, paginable on the SPA
 *  without per-settlement fetches. */
export interface SettlementProcurementIndex {
  generatedAt: string;
  totalEur: number;
  totalContracts: number;
  settlementCount: number;
  /** Excluded-from-pinning rollup (central_ministry / central_agency /
   *  national_state_co / other) so the landing page can show the share
   *  of spending that doesn't have a meaningful geographic home. */
  national: {
    contractCount: number;
    awardCount: number;
    totalEur: number;
    totalOther: Record<string, number>;
    awarderCount: number;
  };
  settlements: Array<{
    ekatte: string;
    name: string;
    province: string;
    obshtina: string;
    contractCount: number;
    totalEur: number;
    awarderCount: number;
  }>;
}

// Per-CPV-division competition baseline. Used to gate the single-bidder red
// flag to markets that are *normally* competitive — a single bid in a division
// that is structurally single-bid (e.g. utility monopolies) is not anomalous
// and would be a false positive. division is the 2-digit CPV prefix.
export interface CpvCompetitionDivision {
  division: string;
  /** Contracts in this division (any bid-data availability). */
  contractCount: number;
  /** Contracts where the realised bid count is known. */
  withBidData: number;
  /** Of withBidData, how many had exactly one bidder. */
  singleBid: number;
  /** singleBid / withBidData (0..1); 0 when withBidData === 0. */
  singleBidShare: number;
}

export interface CpvCompetitionFile {
  generatedAt: string;
  /** Single-bid share at/above which a division is treated as structurally
   *  single-bid, so the per-contract single-bidder flag is suppressed. */
  structuralSingleBidShare: number;
  divisions: CpvCompetitionDivision[];
}

// Sankey-shaped flow to politically-connected people. Only includes
// nodes/edges that participate in a contract won by a company tied to an MP
// or a public official; the full procurement graph would be unreadable.
// Terminal nodes are either `mp:<id>` or `official:<slug>`.
export interface FlowFile {
  generatedAt: string;
  nodes: Array<{
    id: string;
    type: "awarder" | "contractor" | "mp" | "official";
    label: string;
  }>;
  links: Array<{
    source: string;
    target: string;
    // Euro total summed across the edge's contracts (EUR + BGN folded). Edges
    // whose contracts are entirely USD/GBP/CHF are dropped — see derived.ts.
    valueEur: number;
  }>;
}
