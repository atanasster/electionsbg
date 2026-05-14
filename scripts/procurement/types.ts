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
  // Sample of references to the contract month-shards where this contractor
  // appears. Up to N most recent; the SPA's per-contractor page fetches the
  // referenced shards on demand to materialise the full contract list.
  contractRefs: Array<{
    monthFile: string; // e.g. "contracts/2026/2026-04.json"
    indexes: number[]; // positions within that file
  }>;
  generatedAt: string;
}

export interface AwarderRollup {
  eik: string;
  name: string;
  region?: string;
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
  awardCount: number;
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

// Sankey-shaped MP-tied flow. Only includes nodes/edges that participate in
// an MP-connected contract; the full procurement graph would be unreadable.
export interface FlowFile {
  generatedAt: string;
  nodes: Array<{
    id: string;
    type: "awarder" | "contractor" | "mp";
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
