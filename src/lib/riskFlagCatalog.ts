// THE procurement risk-flag catalogue — one declarative source for every flag's
// identity, bit position, threshold, legal basis, label and framing.
//
// WHY THIS FILE EXISTS: these definitions previously lived in six places, kept in
// step by hand — the TS constants in computeProcurementRisk.ts, RISK_MASK_BITS in
// contractRiskMask.ts, CHECK_CATALOG in RiskBadges.tsx, the literals in
// 112_contract_risk_cache.sql, the weights in 041_procurement_risk_grade.sql and
// the thresholds in 033_procurement_risk_indexes.sql — plus two more found while
// doing this, in scripts/procurement/derived.ts and by_ns.ts, which each
// re-declared the concentration threshold AND emit it as `thresholdPct` in a
// served payload. Copies of one rule are the "someone missed one" shape this repo
// keeps paying for (SCOPED_MATVIEWS, declared_label, the six magistrate_current
// copies), and the residue was visible in the prose too: contractRiskMask.ts and
// risk_parity.harness.ts both still described "twelve" checks against thirteen.
//
// It also exists because the flags are becoming a PUBLISHED artifact
// (docs/plans/procurement-risk-open-source-v1.md). A flag that fires on a named
// company is a public claim; the spec will be generated from this file, so it
// cannot say one thing while the code computes another.
//
// WHERE IT LIVES AND WHY: src/lib, React-free and import-free. It has to be
// importable by the SPA, by `scripts/**` generators and gates, by the offline
// harnesses and by vitest — the same position contractRiskMask.ts already
// occupies. CHECK_CATALOG could not do this job in place: it imports
// lucide-react, so no tsx script can read it. RiskBadges.tsx now keeps only the
// icon map and reads everything else from here.
//
// HOW THE OTHER SIDES ARE HELD TO IT:
//   - TypeScript IMPORTS these values. There is no TS generator, deliberately —
//     generating TS from TS would add a build step and a drift window in exchange
//     for nothing an import does not already guarantee.
//   - SQL cannot import, so scripts/risk/risk_catalog_sql_parity.test.ts parses
//     033/041/112 and fails when any literal there disagrees with this file. That
//     is a drift GATE rather than a generator on purpose: these migrations are
//     applied artifacts with deploy semantics (a 90-minute contracts reload, or
//     apply_functions.ts + a cache rebuild — see the plan §7.5), and mechanically
//     rewriting a file that is already live on Cloud SQL buys no extra guarantee
//     over failing the build on divergence.
//   - The generated artifacts that are wholly ours — the handbook and
//     public/risk-flags.json — will be emitted by `npm run gen:risk`. That
//     generator does not exist yet; it is T2 of the plan, and nothing in this
//     file depends on it.

/** Semantic version of the flag SET, not of this file. Bump on any flag added,
 *  renamed, reweighted or re-thresholded — never silently.
 *
 *  MAJOR: a flag is removed, or a bit is renumbered (historic masks re-map).
 *  MINOR: a flag is added, a weight or threshold changes.
 *  PATCH: wording, citations, labels — nothing a consumer computes with.
 *
 *  ⚠️ The version a READER should cite is the one stamped into contract_risk_meta
 *  at the last rebuild_contract_risk_cache(), NOT this constant. This one says
 *  what the code declares; the stamped one says what the served masks were
 *  actually computed under, and they diverge for the whole window between a
 *  deploy and a cache rebuild. */
export const CATALOG_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** A declared threshold. `legalBasis` OR `citation` is mandatory — a bare number
 *  in a published spec is unfalsifiable, and the class of drift it invites is
 *  real: risk-v2 §6a records the 14-day EU minimum being mistaken for our own
 *  risk threshold, which it is not (ours is tier-conditional at 12 days). */
export type Threshold =
  | { kind: "gteRatio"; value: number; unit: "share"; basis: string }
  | { kind: "ltDays"; value: number; basis: string }
  | { kind: "lteDays"; value: number; basis: string }
  | { kind: "ltMonths"; value: number; basis: string }
  | { kind: "gteMultiple"; value: number; basis: string }
  | { kind: "gteEur"; value: number; basis: string }
  | { kind: "cpvPrefix"; value: string; basis: string };

// ---------------------------------------------------------------------------
// Contract-grain flags
// ---------------------------------------------------------------------------

export type ContractFlagDef = {
  /** Stable id. Also the name emitted by contract_risk_checks() in 112. */
  readonly id: string;
  /** Bit position in available_mask / fired_mask.
   *
   *  ⚠️ APPEND-ONLY. 112's header states the contract: "append new checks at the
   *  end, never renumber, or historic masks silently re-map." A renumber is a
   *  MAJOR version bump AND requires a full cache rebuild before any reader sees
   *  a mask — riskFlagCatalog.test.ts asserts the order against a committed
   *  literal so it cannot happen by accident. */
  readonly bit: number;
  /** Weight in the LEGACY additive `score`.
   *
   *  ⚠️ NOT an input to any number a reader sees. The published index is
   *  `cri = 100 × fired / available`, unweighted. computeProcurementRisk.ts's own
   *  header: the additive score "is NOT rendered anywhere … it survives only as a
   *  stable internal ordering key", and contractRiskFromMasks() returns 0 for it
   *  because the masks cannot carry it. It is declared here because 112 holds a
   *  second copy that must not drift — not because it means anything published.
   *  The weights that DO drive a published number are the exposure ones below. */
  readonly legacyWeight: number;
  readonly threshold?: Threshold;
  /** Legal basis or literature reference. Rendered in the handbook. */
  readonly citation?: string;
  /** Short source badge on the chip (АОП, КЗК, ЗОП чл.116 ал.2 …). */
  readonly ref?: string;
  /** i18n keys. DECLARED, never derived — five of the thirteen break any
   *  mechanical camelCase→snake rule (newFirmWinner → risk_flag_new_firm_long,
   *  awarderConcentration → …_concentration_long, shortTenderPeriod →
   *  …_short_period_long, splitPurchase → …_split_long, nkidMismatch →
   *  …_nkid_long). Generating the NAMES would orphan translated copy and trip the
   *  i18n prune gate in both directions at once. */
  readonly labelKey: string;
  readonly whyKey: string;
  readonly naReasonKey: string;
  /** One line: when is this check evaluable at all? The denominator rule. */
  readonly availability: string;
  /** ⚠️ What is WRONG, unsettled or currently inert about this check.
   *
   *  Published verbatim in the handbook and in risk-flags.json. This field exists
   *  because a spec that lists only what each flag does is a sales document: a
   *  check evaluable on ZERO contracts, or one whose threshold the project's own
   *  methodology calls uncalibrated, has to say so where a reader will see it —
   *  not in a plan they will never open. */
  readonly caveat?: string;
  /** Measured base rate on the Bulgarian corpus, where one has been measured.
   *  Published beside the threshold because a threshold with no base rate next to
   *  it is a number the reader cannot sanity-check — and because a flag that
   *  fires on 30% of everything is a different object from one that fires on
   *  0.09%. Absent means "not measured", never "zero". */
  readonly baseRate?: string;
};

/** Every contract check, IN BIT ORDER. Display order is separate — see
 *  CONTRACT_DISPLAY_ORDER. */
export const CONTRACT_FLAGS = [
  {
    id: "debarred",
    bit: 0,
    legacyWeight: 80,
    citation: 'АОП register "Стопански субекти с нарушения"',
    ref: "АОП",
    labelKey: "risk_flag_debarred_long",
    whyKey: "risk_flag_debarred_hint",
    naReasonKey: "risk_na_generic",
    availability:
      "Always — the register is corpus-wide, so absence means not listed.",
  },
  {
    id: "mpConnected",
    bit: 1,
    legacyWeight: 50,
    labelKey: "risk_flag_mp_connected_long",
    whyKey: "risk_flag_mp_connected_hint",
    naReasonKey: "risk_na_generic",
    availability: "Always — company_politicians covers the whole corpus.",
  },
  {
    id: "pepConnected",
    bit: 2,
    legacyWeight: 40,
    labelKey: "risk_flag_pep_connected_long",
    whyKey: "risk_flag_pep_connected_hint",
    naReasonKey: "risk_na_pep_connected",
    availability:
      "Always — the non-MP official link set covers the whole corpus.",
  },
  {
    id: "awarderConcentration",
    bit: 3,
    legacyWeight: 30,
    threshold: {
      kind: "gteRatio",
      value: 0.3,
      unit: "share",
      basis:
        "Pair share of the buyer's LIFETIME spend, and only for buyers above the minimum total below (033).",
    },
    citation:
      "House threshold. 30% of a buyer's spend going to one supplier is the conventional red-flag bar in CEE procurement oversight (Transparency International methodology); the €100,000 floor beneath it is ours.",
    ref: "Fazekas / GTI",
    labelKey: "risk_flag_concentration_long",
    whyKey: "risk_flag_concentration_hint",
    naReasonKey: "risk_na_generic",
    availability:
      "Computed corpus-wide per (buyer, supplier) pair — but ONLY for buyers whose lifetime spend clears €100,000. Below that a 100% share is arithmetic rather than concentration, so those pairs are excluded from the flag entirely.",
  },
  {
    id: "amendment",
    bit: 4,
    legacyWeight: 10,
    citation: "ЗОП чл.116",
    ref: "ЗОП чл.116",
    labelKey: "risk_flag_amendment_long",
    whyKey: "risk_flag_amendment_hint",
    naReasonKey: "risk_na_generic",
    availability: "Always — the row's own tag decides it.",
  },
  {
    id: "annexGrowth",
    bit: 5,
    legacyWeight: 30,
    threshold: {
      kind: "gteRatio",
      value: 0.5,
      unit: "share",
      basis:
        "ЗОП чл.116 ал.2 — a 50% cap on the CUMULATIVE value of modifications, stricter than the EU per-modification rule. The ал.3 inflation indexation carries its own separate 50% that does NOT count against ал.2, and чл.116 ал.6 exempts sectoral buyers, so the flag detects the cumulative Δ without being able to say which ground it hit.",
    },
    citation: "ЗОП чл.116 ал.2 (cumulative)",
    ref: "ЗОП чл.116 ал.2",
    labelKey: "risk_flag_annex_growth_long",
    whyKey: "risk_flag_annex_growth_hint",
    naReasonKey: "risk_na_annex_growth",
    availability:
      "Only where an annex actually moved the value — an un-amended contract is excluded from the denominator rather than scored 0.",
  },
  {
    id: "newFirmWinner",
    bit: 6,
    legacyWeight: 30,
    threshold: {
      kind: "ltMonths",
      value: 12,
      basis:
        "Months between the company's founding date and the award. Availability is decided per CONTRACTOR, so a bound on the founding-date source moves the DENOMINATOR, not just the numerator — that asymmetry is what made 30.2% of the corpus disagree across the TS/SQL sides before the parity harness existed.",
    },
    citation:
      "House threshold. A company barely older than the contract it won is a structural signal, not a rule from a named index — an earlier draft of this catalogue cited a 'K-Index P4' that does not exist.",
    ref: "K-Index",
    labelKey: "risk_flag_new_firm_long",
    whyKey: "risk_flag_new_firm_hint",
    naReasonKey: "risk_na_new_firm",
    availability:
      "Only where the contractor's founding date is known and precedes the award.",
  },
  {
    id: "splitPurchase",
    bit: 7,
    legacyWeight: 25,
    citation:
      "ЗОП чл.20 ал.4 / чл.21. Reference implementations: OCP R049, ProZorro RISK-2-5/2-6, K-Index P3.",
    ref: "ЗОП чл.20 ал.4",
    labelKey: "risk_flag_split_long",
    whyKey: "risk_flag_split_hint",
    naReasonKey: "risk_na_generic",
    availability:
      "Always — but it is a QUESTION, not a verdict: чл.21 permits separate recurring needs, and the data cannot distinguish that from splitting.",
    baseRate: "0.09% of contracts (risk-v2 §6b-results)",
  },
  {
    id: "appealUpheld",
    bit: 8,
    legacyWeight: 70,
    citation: "КЗК decision (уважена жалба)",
    ref: "КЗК",
    labelKey: "risk_flag_appeal_upheld_long",
    whyKey: "risk_flag_appeal_upheld_hint",
    naReasonKey: "risk_na_appeal_upheld",
    availability:
      "Always server-side — the appeal corpus is joined corpus-wide.",
  },
  {
    id: "weakCompetition",
    bit: 9,
    legacyWeight: 40,
    threshold: {
      kind: "gteRatio",
      value: 0.8,
      unit: "share",
      basis:
        "STRUCTURAL SUPPRESSION, at 2-digit CPV DIVISION grain: where a division's own single-bid share reaches this, one bid is the market's norm rather than a signal. The flag's second, GRADED arm keys on the 5-digit CPV PREFIX median instead (competitive markets only, median ≥ 3) — two different grains in one flag, which is the detail most often restated wrongly.",
    },
    citation: "EC Single Market Scoreboard; ЗОП чл.79 ал.1 т.3",
    ref: "Fazekas / GTI",
    labelKey: "risk_flag_weak_competition_long",
    whyKey: "risk_flag_weak_competition_hint",
    naReasonKey: "risk_na_weak_competition",
    availability: "Only where the realised bid count is known.",
  },
  {
    id: "directAward",
    bit: 10,
    legacyWeight: 20,
    citation: 'EC Single Market Scoreboard ("no calls for bids")',
    ref: "Fazekas / GTI",
    labelKey: "risk_flag_direct_award_long",
    whyKey: "risk_flag_direct_award_hint",
    naReasonKey: "risk_na_direct_award",
    availability:
      "Only where a procedure type or a no-notice rationale is recorded.",
  },
  {
    id: "shortTenderPeriod",
    bit: 11,
    legacyWeight: 15,
    threshold: {
      kind: "ltDays",
      value: 14,
      basis:
        "Lifted from EU Directive 2014/24 Art. 27 as a round reference figure. ⚠️ That makes it a LEGAL MINIMUM rather than a calibrated risk threshold — Art. 27's own minima are longer and tiered (35 days, 30 with electronic submission, 15 under an accelerated procedure), so 14 is our simplification of it and not a rule the Directive states. The project's own methodology (risk-v2 §6a) records the cut as uncalibrated and due to be re-cut into bands. The TENDER-grain rushedDeadline deliberately differs (12 days, competitive tiers only), because on low-value tiers a short window is statutory rather than anomalous.",
    },
    citation:
      "EU Dir 2014/24 Art. 27 (a reference figure, not a rule it states)",
    ref: "ЕС 2014/24 чл.27",
    labelKey: "risk_flag_short_period_long",
    whyKey: "risk_flag_short_period_hint",
    naReasonKey: "risk_na_short_period",
    availability:
      "Only where both tender-window dates are present and ordered.",
    caveat:
      "CURRENTLY INERT. The tender-window columns are unpopulated across the contracts corpus, so this check is evaluable on effectively no contracts — measured 0 of 20,000 sampled. It is neither firing nor passing: it is excluded from every contract's CRI denominator. Listed here because it is implemented and would begin scoring the moment those dates arrive, not because it contributes today.",
  },
  {
    id: "nkidMismatch",
    bit: 12,
    legacyWeight: 20,
    citation: "КИД-2008 ↔ CPV crosswalk (src/lib/naceCpv.ts)",
    ref: "НКИД / CPV",
    labelKey: "risk_flag_nkid_long",
    whyKey: "risk_flag_nkid_hint",
    naReasonKey: "risk_na_nkid",
    availability:
      "Only where the contractor's declared НКИД division is known AND the contract carries a CPV.",
  },
] as const satisfies readonly ContractFlagDef[];

export type RiskComponentKey = (typeof CONTRACT_FLAGS)[number]["id"];

/** The same flags, WIDENED for iteration.
 *
 *  `as const satisfies` above is what preserves the literal `id`s that
 *  RiskComponentKey derives from — but it also narrows every element to its own
 *  exact shape, so `flag.threshold` and `flag.ref` are unreadable off the union
 *  for the entries that omit them. Anything that loops over the catalogue (the
 *  gates, the generators, the handbook) reads this binding; anything that needs
 *  the literal types reads CONTRACT_FLAGS. */
export const CONTRACT_FLAG_LIST: readonly ContractFlagDef[] = CONTRACT_FLAGS;

/** Bit positions, ordered. The SINGLE derivation — contractRiskMask.ts's decoder
 *  and the SQL parity gate both read this rather than keeping a literal. */
export const RISK_MASK_BITS: readonly RiskComponentKey[] = [...CONTRACT_FLAGS]
  .sort((a, b) => a.bit - b.bit)
  .map((f) => f.id);

/** Ledger/chip order — heaviest-first within each state bucket, which is NOT bit
 *  order. Kept as its own list because presentation order is a UI decision and
 *  bit order is a wire format; conflating them once would make a reordering of
 *  the ledger silently re-map every historic mask. */
export const CONTRACT_DISPLAY_ORDER: readonly RiskComponentKey[] = [
  "debarred",
  "appealUpheld",
  "mpConnected",
  "weakCompetition",
  "pepConnected",
  "awarderConcentration",
  "annexGrowth",
  "newFirmWinner",
  "splitPurchase",
  "nkidMismatch",
  "directAward",
  "shortTenderPeriod",
  "amendment",
];

// Widened on the read path. `as const satisfies` above is what preserves the
// literal `id`s (RiskComponentKey derives from them), but it also narrows each
// element to its own exact shape — so `threshold` and `ref` are not readable off
// the union for the entries that omit them. The map restores the declared type.
const BY_ID: ReadonlyMap<string, ContractFlagDef> = new Map(
  CONTRACT_FLAGS.map((f) => [f.id, f as ContractFlagDef]),
);

export const contractFlag = (id: RiskComponentKey): ContractFlagDef => {
  const f = BY_ID.get(id);
  if (!f) throw new Error(`riskFlagCatalog: unknown contract flag ${id}`);
  return f;
};

/** Numeric threshold for a flag, by id. Throws rather than returning a default —
 *  a silent fallback here would be a scorer running on a number nobody declared. */
export const contractThreshold = (id: RiskComponentKey): number => {
  const t = contractFlag(id).threshold;
  if (!t || typeof t.value !== "number")
    throw new Error(`riskFlagCatalog: ${id} declares no numeric threshold`);
  return t.value;
};

/** The minimum buyer lifetime spend a concentration pair must clear (033). Held
 *  beside the 0.3 share because the two are one rule: a 100%-share pair on a
 *  buyer with one €400 contract is arithmetic, not concentration. */
export const CONCENTRATION_MIN_AWARDER_TOTAL_EUR = 100_000;

/** Statutory sole-source CPV prefix — textbooks, awarded by law to the copyright
 *  holder (ЗОП чл.79 ал.1 т.3). Suppresses weakCompetition regardless of the
 *  division's aggregate share: single-bid here is the statute, not the market. */
export const LEGALLY_SINGLE_SOURCE_CPV_PREFIX = "22112";

// ---------------------------------------------------------------------------
// Tender-grain flags (ex-ante, per procedure)
// ---------------------------------------------------------------------------

export type TenderFlagDef = {
  readonly id: string;
  readonly threshold?: Threshold;
  readonly citation?: string;
  readonly availability: string;
  /** ⚠️ What is WRONG, unsettled or currently inert about this check.
   *
   *  Published verbatim in the handbook and in risk-flags.json. This field exists
   *  because a spec that lists only what each flag does is a sales document: a
   *  check evaluable on ZERO contracts, or one whose threshold the project's own
   *  methodology calls uncalibrated, has to say so where a reader will see it —
   *  not in a plan they will never open. */
  readonly caveat?: string;
  /** Measured base rate on the Bulgarian corpus, where one exists. The single
   *  strongest trust signal in the published spec — a threshold with no base
   *  rate beside it is a number a reader cannot sanity-check. */
  readonly baseRate?: string;
};

/** Four checks. NOTE the asymmetry with the contract grain, which is real rather
 *  than an omission: tender flags have no bit mask, no additive weight and no
 *  server-side cache — they are computed live from the procedure row. */
export const TENDER_FLAGS = [
  {
    id: "nonOpenProcedure",
    citation: 'EC Single Market Scoreboard ("no calls for bids")',
    availability: "Only where a procedure type is recorded.",
    baseRate: "14.3% (126,413 tenders, 2020–2026) — stable by year",
  },
  {
    id: "rushedDeadline",
    threshold: {
      kind: "ltDays",
      value: 12,
      basis:
        "TIER-CONDITIONAL, and deliberately NOT the 14-day EU legal minimum. Scored only on the competitive tiers (Открита процедура / Публично състезание), where medians are 30d and 21d; on low-value tiers a ~10-day window is statutory, and 44% of 'Събиране на оферти' sits at 7–11 days.",
    },
    citation: "Calibrated on the BG corpus (risk-v2 §6b-results)",
    availability: "Competitive tiers only, with both dates present.",
    baseRate: "~0.3–1% on the competitive tiers",
  },
  {
    id: "shortDecisionPeriod",
    threshold: {
      kind: "lteDays",
      value: 4,
      basis:
        "Award decided within this many days of the submission deadline, INCLUSIVE — the implementation compares `<= 4`, so a 4-day decision fires. (An earlier draft of this catalogue published it as `< 4`, which is off by one day.)",
    },
    citation: "World Bank PRWP 10444 short band",
    availability: "Only once the procedure is awarded.",
    baseRate: "3.2%",
    caveat:
      "DIRECTION UNSETTLED. The flag scores SHORT decision periods, but PRWP 10444's own prose justifies risk via the opposite mechanism — that a lengthy decision period gives room for repeated legal challenges until the award reaches a chosen company. The calibration penalises short while the source narrative worries about long: an inconsistency in the source, documented rather than resolved. Treat this as the weakest of the four tender checks.",
  },
  {
    id: "awardOverEstimate",
    threshold: {
      kind: "gteMultiple",
      value: 1.1,
      basis:
        "Awards summing above this multiple of the procedure estimate. ONE-SIDED by design: awards UNDER the estimate are usually competition savings, and OCP R016's under-valuation is a different comparison (estimate vs the peer-CPV norm), which the normalcy panel already carries. The 10% buffer absorbs rounding and minor scope changes — median awarded/estimated is 99%, p95 is 105%.",
    },
    citation:
      "PwC/Ecorys (2013), the only source with measured per-flag weights. ⚠️ Those weights are conditional on a 50/50 case-control sample, so they order flags rather than estimate precision — and an earlier draft of this catalogue cited a specific flag number from it that could not be verified in-repo.",
    availability:
      "Only where a procedure estimate and at least one award exist.",
    baseRate: "4.1%",
  },
] as const satisfies readonly TenderFlagDef[];

export type TenderRiskKey = (typeof TENDER_FLAGS)[number]["id"];

/** Widened for iteration — see CONTRACT_FLAG_LIST. */
export const TENDER_FLAG_LIST: readonly TenderFlagDef[] = TENDER_FLAGS;

const TENDER_BY_ID: ReadonlyMap<string, TenderFlagDef> = new Map(
  TENDER_FLAGS.map((f) => [f.id, f as TenderFlagDef]),
);

export const tenderFlag = (id: TenderRiskKey): TenderFlagDef => {
  const f = TENDER_BY_ID.get(id);
  if (!f) throw new Error(`riskFlagCatalog: unknown tender flag ${id}`);
  return f;
};

export const tenderThreshold = (id: TenderRiskKey): number => {
  const t = tenderFlag(id).threshold;
  if (!t || typeof t.value !== "number")
    throw new Error(
      `riskFlagCatalog: tender flag ${id} declares no numeric threshold`,
    );
  return t.value;
};

// ---------------------------------------------------------------------------
// Exposure grade (041) — TWO weight sets, not one
// ---------------------------------------------------------------------------

export type ExposureComponentDef = {
  readonly key: string;
  readonly weight: number;
  /** false = the component sits in the denominator on every row. Only the
   *  supplier's own political link does this; every other component is dropped
   *  from the availability-weighted mean when its input is NULL. */
  readonly alwaysAvailable?: boolean;
};

/** BUYER weights. `awarder_risk_grade_frac()` in 041 is their only SQL copy and
 *  both consumers (per-entity and windowed) call it.
 *
 *  Rebalanced 2026-07-18 (risk-v2 §8): direct 0.20→0.30, singleBid 0.25→0.15,
 *  total unchanged at 1.30 so the score scale did not move. The evidence is the
 *  EC Single Market Scoreboard — Bulgaria's genuine outlier is "no calls for
 *  bids" (~20% vs an EU median of 5%), while single-bidding (36%) sits below its
 *  CEE peers and therefore does not discriminate. Measured effect: of 1,149
 *  ranked buyers 234 changed grade (226 better, 8 worse); the two worst were
 *  unchanged. The Scoreboard does NOT measure corruption — that caveat travels
 *  with the weights wherever they are published. */
export const AWARDER_EXPOSURE_COMPONENTS = [
  { key: "connection", weight: 0.35 },
  { key: "singleBid", weight: 0.15 },
  { key: "direct", weight: 0.3 },
  { key: "concentration", weight: 0.2 },
  { key: "upheldAppeal", weight: 0.3 },
] as const satisfies readonly ExposureComponentDef[];

/** Widened for iteration — see CONTRACT_FLAG_LIST. */
export const AWARDER_EXPOSURE_LIST: readonly ExposureComponentDef[] =
  AWARDER_EXPOSURE_COMPONENTS;

/** SUPPLIER weights — a DIFFERENT set, and three differences are load-bearing:
 *
 *  1. There is NO upheldAppeal arm. A КЗК decision is an integrity signal about
 *     the BUYER's procedure; it is not folded into a supplier's grade.
 *  2. These are the PRE-rebalance direct/singleBid weights. risk-v2 §8 moved the
 *     buyer arm only; §0a notes the supplier set "appear only once and were left
 *     alone", which is an observation about COPIES, not a decision about VALUES.
 *     Whether that is a deliberate exception (a supplier does not choose the
 *     procedure) or drift is an OPEN QUESTION — see the plan §3a. The handbook
 *     states both sets and records the question rather than asserting either
 *     reading.
 *  3. connectedSelf is unconditionally available, so its 0.30 sits in the
 *     denominator on every row.
 *
 *  Publishing the buyer's Scoreboard rationale as "the exposure weights" would
 *  attribute to the supplier grade a change it never received — and the supplier
 *  grade is the one a COMPANY reads about itself. */
export const SUPPLIER_EXPOSURE_COMPONENTS = [
  { key: "connectedSelf", weight: 0.3, alwaysAvailable: true },
  { key: "singleBid", weight: 0.25 },
  { key: "direct", weight: 0.2 },
  { key: "buyerConcentration", weight: 0.25 },
] as const satisfies readonly ExposureComponentDef[];

/** Widened for iteration — see CONTRACT_FLAG_LIST. */
export const SUPPLIER_EXPOSURE_LIST: readonly ExposureComponentDef[] =
  SUPPLIER_EXPOSURE_COMPONENTS;

// ---------------------------------------------------------------------------
// Neutral disclosure — never scored
// ---------------------------------------------------------------------------

/** Foreign-funded-NGO disclosure (080). Deliberately NOT a flag: it does not
 *  touch the CRI, the fired count or any grade. Foreign funding is lawful
 *  disclosure, and rendering it as a red flag would be a "foreign agent" framing
 *  this project does not make. It is declared here so the published catalogue can
 *  say so explicitly rather than leaving its absence to be inferred. */
export const NEUTRAL_DISCLOSURES = [
  {
    id: "ngoForeignFunded",
    scored: false as const,
    availability:
      "Where the contractor is, or is linked to, a foreign-funded NGO.",
    note: "Neutral disclosure. Never affects the CRI or any grade.",
  },
] as const;

// ---------------------------------------------------------------------------
// Framing — the sentence that must travel with any reuse
// ---------------------------------------------------------------------------

/** Adopted from OCP, *Red Flags for Integrity* (2024) p. 13. The ordering names
 *  the two innocent explanations before the guilty one; it is a presentation
 *  order, NOT a claim about relative frequency. */
/** How many checks fire per contract, over the whole corpus. Measured
 *  2026-07-27 across 407,560 contracts and recorded in 112's header; it is what
 *  the per-contract grade is banded on, and it is the number that makes "F" mean
 *  something. Published because a reader who does not know that 63.5% of
 *  contracts fire NOTHING cannot calibrate a contract that fires two. */
export const FIRED_COUNT_DISTRIBUTION = [
  { fired: 0, contracts: 258_706, share: "63.5%" },
  { fired: 1, contracts: 122_334, share: "30.0%" },
  { fired: 2, contracts: 23_098, share: "5.7%" },
  { fired: 3, contracts: 2_938, share: "0.72%" },
  { fired: 4, contracts: 403, share: "0.10%" },
  { fired: 5, contracts: 70, share: "0.02%" },
  { fired: 6, contracts: 11, share: "0.003%" },
] as const;

/** Corpus the distribution above was measured over. */
export const FIRED_COUNT_CORPUS = {
  contracts: 407_560,
  measuredOn: "2026-07-27",
} as const;

/** The per-contract A–F bands. Banded on the FIRED COUNT, not the CRI — see the
 *  handbook's "three grades" section for why the CRI cannot carry them (its
 *  corpus maximum is 60, which makes F unreachable on 041's cutoffs). */
export const CONTRACT_GRADE_BANDS = [
  { grade: "A", fired: "0" },
  { grade: "B", fired: "1" },
  { grade: "C", fired: "2" },
  { grade: "D", fired: "3" },
  { grade: "E", fired: "4" },
  { grade: "F", fired: "5 or more" },
] as const;

export const FLAG_FRAMING = {
  ocp:
    "A fired flag means the behaviour may be a) not at all illicit or suboptimal; " +
    "b) not illicit, but suboptimal in terms of value for money; or c) illicit.",
  publisher:
    "We are a public publisher, not a monitoring institution with a legal mandate. " +
    "Flags fire for review; they are not findings of wrongdoing.",
  denominator:
    "The CRI's denominator is the checks we could AVAILABLY evaluate, never all checks — " +
    "a data-poor contract is excluded from a check, never scored 0 on it.",
} as const;
