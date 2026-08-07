// Domain types for the Interreg corpus (docs/plans/interreg-funds-ingest-v1.md).
//
// The grain is the thing to keep straight: an Interreg OPERATION has N PARTNERS,
// each with its own budget line and its own country. `fund_projects` (ИСУН) is
// one row per contract with one beneficiary and one `total_eur`; that shape
// cannot hold this one, which is why §4 of the plan puts Interreg in sibling
// tables rather than appending.
//
// The invariant every consumer inherits: the OPERATION total lives on
// InterregOperation, the PARTNER budget on InterregPartner, and no money
// aggregate ever reads across the join. Storing an operation total against one
// partner is the €2m-for-a-€300k-partner inversion the plan exists to prevent.

/** The two programming periods we ingest. 2007-2013 and earlier are fenced out
 *  deliberately: keep.eu holds them, but the partner-budget field did not exist
 *  then and is `n/a` on every row, so they would be counts with no money. */
export type InterregPeriod = "2014-2020" | "2021-2027";

export const INTERREG_PERIODS: readonly InterregPeriod[] = [
  "2014-2020",
  "2021-2027",
];

/**
 * Why a partner's `budget_eur` is what it is. Three states, all distinct, none
 * inferred — collapsing the middle one into the last loses a real fact.
 *
 * - `published`      — a non-NULL, non-zero budget the programme published.
 * - `published_zero` — a literal 0.00. A co-beneficiary carrying no budget line
 *                      is a real arrangement (observed on 2 of 30 sampled
 *                      2014-2020 rows), not a missing value.
 * - `unpublished`    — NULL. Contributes ZERO to money and still counts in
 *                      project counts. We never equal-split an operation total
 *                      to fill it: that would invent a number the source never
 *                      stated.
 */
export type BudgetBasis = "published" | "published_zero" | "unpublished";

/** Runtime counterpart of the union, for validating a parsed value in parse.ts.
 *  TypeScript cannot derive it, so types.test.ts gates the two against drift. */
export const BUDGET_BASES: readonly BudgetBasis[] = [
  "published",
  "published_zero",
  "unpublished",
];

/**
 * How a Bulgarian partner row got its EKATTE. Stored per row so a consumer can
 * filter by confidence, exactly as `tr_company_place.confidence` does.
 *
 * The `eik:` bands are Tier L (2021-2027 only — the national-ID field does not
 * exist in the 2014-2020 template). Everything below is Tier P: geography with
 * no legal identity behind it. NULL place_basis iff NULL ekatte.
 */
export type PlaceBasis =
  | "eik:awarder_seats"
  | "eik:tr"
  | "postal+name+province"
  | "postal+name"
  | "postal_only"
  | "name+province"
  | "name_only"
  | "roster";

/** Runtime counterpart of the union. Gated against drift in types.test.ts. */
export const PLACE_BASES: readonly PlaceBasis[] = [
  "eik:awarder_seats",
  "eik:tr",
  "postal+name+province",
  "postal+name",
  "postal_only",
  "name+province",
  "name_only",
  "roster",
];

/**
 * Tier L rows carry a legal identity; Tier P rows carry only a place.
 *
 * The SQL side does this split inline (`WHERE eik IS NOT NULL`); this predicate
 * exists for the TypeScript side — `measure.ts` splits the recovered money by
 * tier, which is where the plan's "roughly two-thirds of the money is Tier P"
 * comes from, and that number has to be re-derivable rather than quoted.
 */
export const isLinkedBasis = (b: PlaceBasis | null): boolean =>
  b === "eik:awarder_seats" || b === "eik:tr";

/**
 * A programme we admit. The registry in ./programmes.ts is the ONLY place a
 * keep.eu programme becomes ingestable — an id with no entry here is skipped
 * with a warning rather than minting an unnamed code.
 */
export interface InterregProgramme {
  /** keep.eu programme id — the join key against `/api/programme/<id>/`. */
  readonly keepProgrammeId: number;
  /** Stable curated slug, `INTERREG-<pair>-<period>`. Never derived from a title. */
  readonly code: string;
  readonly period: InterregPeriod;
  /** Name as МРРБ publishes it. Curated, never machine-translated. */
  readonly nameBg: string;
  /**
   * Name as keep.eu / the programme publishes it — EXCEPT where the source
   * still uses a superseded country name, in which case we publish the current
   * one and `keepTitle` records what keep.eu actually says.
   */
  readonly nameEn: string;
  /**
   * keep.eu's own title, ONLY when it differs from `nameEn`. This exists so a
   * registry-vs-keep.eu consistency check can tell a deliberate divergence from
   * a wrong `keepProgrammeId` — without it the difference survives as a code
   * comment no gate can read.
   */
  readonly keepTitle?: string;
  /** CCI where the programme has one (2021-2027 publishes these; 2014-2020 does not). */
  readonly cci?: string;
  /**
   * Bulgarian eligible area, as NUTS codes read from keep.eu's own
   * `eligible_geographical_area`. Mixed level on purpose: the Black Sea Basin
   * programmes are eligible at NUTS2 (BG33, BG34) while the land-border ones
   * are NUTS3, so membership is a PREFIX test, not equality.
   * `null` means the whole country is eligible.
   */
  readonly eligibleNuts: readonly string[] | null;
  /**
   * What keep.eu actually holds for this programme, so a thin arm is a stated
   * gap rather than a silent one. Free text, quoted from the measurement.
   */
  readonly coverageNote?: string;
}

/** One Interreg operation. `total_budget_eur` is the OPERATION total — never a partner's. */
export interface InterregOperation {
  /**
   * keep.eu project id. The PK, and the only always-present unique key:
   * `project_id` is NULL for every sampled 2014-2020 operation.
   */
  keepId: number;
  /** The programme's own operation id (BSB00963, BGTR0200037). NULL for 2014-2020. */
  operationId: string | null;
  programmeCode: string;
  period: InterregPeriod;
  /** keep.eu publishes titles in English only — 107 of 107 sampled had no `bg`. */
  titleEn: string;
  /** NULL until a Bulgarian source exists. Never machine-translated (plan §7). */
  titleBg: string | null;
  summaryEn: string | null;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  totalBudgetEur: number | null;
  euFundingEur: number | null;
  coFinancingRate: number | null;
  partnerCount: number | null;
  /** ISO2 codes of every participating country, sorted. */
  countries: string[];
  sourceFetchedAt: string;
}

/**
 * One partner on one operation. ALL partners are stored, not only Bulgarian
 * ones — the foreign partners are what make an operation legible as
 * cross-border. Only `country === "BG"` rows are ever placed or counted as
 * Bulgarian money.
 */
export interface InterregPartner {
  keepId: number;
  /** Position within the operation's partnership array. Part of the PK. */
  partnerSeq: number;
  keepPartnerId: number | null;
  isLead: boolean;
  /** ISO2. */
  country: string;
  /** As published, Cyrillic where the programme publishes it (129 of 136 sampled). */
  partnerName: string;
  partnerNameEn: string | null;
  /** 2021-2027 only; NULL for 2014-2020, whose template has no identity column. */
  eik: string | null;
  pic: string | null;
  /** keep.eu's own organisation-type vocabulary, verbatim — NOT a mapping of ИСУН's `org_kind`. */
  orgType: string | null;
  legalStatus: string | null;
  budgetEur: number | null;
  euFundingEur: number | null;
  budgetBasis: BudgetBasis;
  locationRaw: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
}

/** What ingest.ts writes to data/funds/interreg/. Carries NO ekatte: place
 *  resolution is loader-side, because Tiers L1/L2 read Postgres tables and an
 *  ingest that reached into PG would make the committed tree unreproducible
 *  from a fresh clone (plan §8). */
export interface InterregCorpus {
  operations: InterregOperation[];
  partners: InterregPartner[];
}

/**
 * `data/funds/interreg/index.json` — the manifest beside the two corpus files.
 *
 * It is a manifest rather than a summary on purpose: the per-programme row is
 * what makes a thin arm visible. A programme that yields zero operations
 * (BG-Serbia 2021-2027 today) must appear here WITH a zero, because a missing
 * row and a zero row mean opposite things — "we never asked" versus "we asked
 * and the source has nothing".
 */
export interface InterregIndex {
  /** When the underlying keep.eu crawl ran. */
  fetchedAt: string;
  operationCount: number;
  partnerCount: number;
  /** Partner rows with `country === "BG"` — the only ones that become money here. */
  bgPartnerCount: number;
  programmes: {
    code: string;
    period: InterregPeriod;
    operationCount: number;
    partnerCount: number;
    bgPartnerCount: number;
    /** Σ of BG partners' published budgets. Excludes `unpublished` by construction. */
    bgBudgetEur: number;
    /** BG rows whose budget the programme does not publish — stated, never split. */
    bgUnpublishedCount: number;
  }[];
}
