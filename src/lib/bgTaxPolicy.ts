// National tax-policy scoring engine for the budget policy simulator
// (/budget/simulator). Where bgTax.ts answers "what does THIS person pay",
// this module answers "what happens to BUDGET REVENUE if a rate changes".
//
// Method: STATIC scoring — the tax base is held fixed at the baseline year,
// no behavioral response. Defensible for small rate moves; the UI carries the
// caveat. Baseline figures come from data/budget/derived/policy_baseline.json
// (assembled offline by scripts/budget/run_policy_baseline.ts), so every
// number scored here traces to КФП execution, the НАП annual report, Eurostat
// national accounts, or the НОИ/Eurostat contribution aggregates.
//
// The VAT side rides on COICOP household consumption (Eurostat
// nama_10_co3_p3): each consumption slice carries its statutory VAT regime,
// and the model's gap to actual ДДС revenue (households are only part of the
// base) is bridged by a calibration factor that is stable across 2021-2025 —
// see scripts/budget/__smoke_vat_model.ts for the year-by-year validation.

import {
  PIT_RATE,
  CORP_TAX_RATE,
  DIVIDEND_TAX_RATE,
  VAT_STANDARD_RATE,
  SSC_EMPLOYEE_RATE,
} from "./bgTax";

export const VAT_REDUCED_RATE = 0.09;

// ---------------------------------------------------------------------------
// VAT slice map — the single source of truth shared by the simulator, the
// baseline script and the calibration smoke test.
// ---------------------------------------------------------------------------

/** UI-adjustable category groups. `other` (residual standard-rated) and
 *  `exempt` (out of scope of ЗДДС or exempt without credit) exist as slices
 *  but are not regime-switchable in the simulator. */
export type VatGroup =
  | "food"
  | "medicines"
  | "energy"
  | "restaurants"
  | "hotels"
  | "books"
  | "other"
  | "exempt";

export type VatRegime = "standard" | "reduced" | "zero";

export interface VatSlice {
  /** COICOP code the value is read from (division or 3-digit group). */
  code: string;
  /** Fraction of the COICOP category this slice covers (sub-splits where the
   *  VAT regime cuts below the published grain). */
  share: number;
  /** Simulator group the slice belongs to. */
  group: VatGroup;
  /** Statutory rate at a given year — encodes the temporary windows
   *  (restaurants 9% Jul-2020→Dec-2024, bread 0% Jul-2022→Jun-2024, gas &
   *  district heating 9% Jul-2022→Dec-2024) for calibration back-years.
   *  `null` = outside the VAT base entirely (imputed rents) or exempt. */
  rateAt: (year: number) => number | null;
}

const STANDARD = () => VAT_STANDARD_RATE;
const REDUCED = () => VAT_REDUCED_RATE;
const EXEMPT = () => null;
const cateringRate = (y: number) => (y <= 2024 ? 0.09 : VAT_STANDARD_RATE);
const breadRate = (y: number) =>
  y === 2022 ? 0.1 : y === 2023 ? 0 : y === 2024 ? 0.1 : VAT_STANDARD_RATE;
const gasHeatRate = (y: number) =>
  y < 2022
    ? VAT_STANDARD_RATE
    : y === 2022
      ? 0.145
      : y <= 2024
        ? 0.09
        : VAT_STANDARD_RATE;

// Sub-3-digit share assumptions (bread within food, gas+heat within energy,
// books vs stationery, gambling within recreation) mirror the methodology
// notes on the simulator page — change them there too.
export const VAT_SLICES: VatSlice[] = [
  { code: "CP01", share: 0.05, group: "food", rateAt: breadRate },
  { code: "CP01", share: 0.95, group: "food", rateAt: STANDARD },
  { code: "CP02", share: 1, group: "other", rateAt: STANDARD },
  { code: "CP03", share: 1, group: "other", rateAt: STANDARD },
  { code: "CP041", share: 1, group: "exempt", rateAt: EXEMPT },
  // CP042 imputed rents: not a transaction — deliberately absent.
  { code: "CP043", share: 1, group: "other", rateAt: STANDARD },
  { code: "CP044", share: 1, group: "other", rateAt: STANDARD },
  { code: "CP045", share: 0.2, group: "energy", rateAt: gasHeatRate },
  { code: "CP045", share: 0.8, group: "energy", rateAt: STANDARD },
  { code: "CP05", share: 1, group: "other", rateAt: STANDARD },
  { code: "CP061", share: 1, group: "medicines", rateAt: STANDARD },
  { code: "CP062", share: 1, group: "exempt", rateAt: EXEMPT },
  { code: "CP063", share: 1, group: "exempt", rateAt: EXEMPT },
  { code: "CP07", share: 1, group: "other", rateAt: STANDARD },
  { code: "CP081", share: 1, group: "exempt", rateAt: EXEMPT },
  { code: "CP082", share: 1, group: "other", rateAt: STANDARD },
  { code: "CP083", share: 1, group: "other", rateAt: STANDARD },
  { code: "CP091", share: 1, group: "other", rateAt: STANDARD },
  { code: "CP092", share: 1, group: "other", rateAt: STANDARD },
  { code: "CP093", share: 1, group: "other", rateAt: STANDARD },
  { code: "CP094", share: 0.4, group: "exempt", rateAt: EXEMPT },
  { code: "CP094", share: 0.6, group: "other", rateAt: STANDARD },
  { code: "CP095", share: 0.6, group: "books", rateAt: REDUCED },
  { code: "CP095", share: 0.4, group: "other", rateAt: STANDARD },
  { code: "CP096", share: 1, group: "other", rateAt: STANDARD },
  { code: "CP10", share: 1, group: "exempt", rateAt: EXEMPT },
  { code: "CP111", share: 1, group: "restaurants", rateAt: cateringRate },
  { code: "CP112", share: 1, group: "hotels", rateAt: REDUCED },
  { code: "CP121", share: 1, group: "other", rateAt: STANDARD },
  { code: "CP123", share: 1, group: "other", rateAt: STANDARD },
  { code: "CP124", share: 1, group: "exempt", rateAt: EXEMPT },
  { code: "CP125", share: 1, group: "exempt", rateAt: EXEMPT },
  { code: "CP126", share: 1, group: "exempt", rateAt: EXEMPT },
  { code: "CP127", share: 1, group: "other", rateAt: STANDARD },
];

/** The groups the simulator lets the user re-rate, in display order. */
export const VAT_ADJUSTABLE_GROUPS = [
  "food",
  "medicines",
  "energy",
  "restaurants",
  "hotels",
  "books",
] as const;
export type VatAdjustableGroup = (typeof VAT_ADJUSTABLE_GROUPS)[number];

/** Current-law regime of each adjustable group at the baseline year. */
export const VAT_GROUP_DEFAULT_REGIME: Record<VatAdjustableGroup, VatRegime> = {
  food: "standard",
  medicines: "standard",
  energy: "standard",
  restaurants: "standard",
  hotels: "reduced",
  books: "reduced",
};

export interface VatPolicy {
  /** Standard rate (current law 0.20). */
  standardRate: number;
  /** Reduced rate (current law 0.09). */
  reducedRate: number;
  /** Per-group regime reassignment; absent key = current law. */
  regimes: Partial<Record<VatAdjustableGroup, VatRegime>>;
}

export const VAT_POLICY_CURRENT: VatPolicy = {
  standardRate: VAT_STANDARD_RATE,
  reducedRate: VAT_REDUCED_RATE,
  regimes: {},
};

/** One pre-scaled consumption slice as shipped in policy_baseline.json —
 *  the slice map above joined to its baseline-year EUR value. */
export interface VatBaseSlice {
  group: VatGroup;
  /** Baseline-year consumption value covered by this slice, EUR. */
  valueEur: number;
  /** Statutory regime at the baseline year (null = exempt / out of scope). */
  regime: VatRegime | null;
}

const regimeRate = (regime: VatRegime | null, policy: VatPolicy): number => {
  if (regime === "standard") return policy.standardRate;
  if (regime === "reduced") return policy.reducedRate;
  return 0;
};

export interface VatRevenueResult {
  /** Modeled household VAT under the policy, EUR (uncalibrated). */
  modeledEur: number;
}

/** Run the household VAT model under a policy. VAT-inclusive consumption →
 *  embedded VAT is value × r/(1+r). */
export const computeVatRevenue = (
  slices: VatBaseSlice[],
  policy: VatPolicy,
): VatRevenueResult => {
  let modeledEur = 0;
  for (const s of slices) {
    if (s.regime === null) continue;
    const adjustable = (VAT_ADJUSTABLE_GROUPS as readonly string[]).includes(
      s.group,
    );
    const regime =
      adjustable && policy.regimes[s.group as VatAdjustableGroup]
        ? policy.regimes[s.group as VatAdjustableGroup]!
        : s.regime;
    const r = regimeRate(regime, policy);
    modeledEur += s.valueEur * (r / (1 + r));
  }
  return { modeledEur };
};

// ---------------------------------------------------------------------------
// Flat-rate taxes — static proportional scaling of the executed КФП line.
// ---------------------------------------------------------------------------

/** ДДФЛ: only the flat-rate-sensitive part of the КФП line scales (the
 *  окончателен данък portion — dividends to individuals, non-residents — has
 *  its own 5% rate and is excluded via `rateSensitiveShare` from the НАП
 *  annual report). */
export const scorePitFlat = (
  pitRevenueEur: number,
  rateSensitiveShare: number,
  newRate: number,
): number => pitRevenueEur * rateSensitiveShare * (newRate / PIT_RATE - 1);

export const scoreCorporate = (
  corpRevenueEur: number,
  newRate: number,
): number => corpRevenueEur * (newRate / CORP_TAX_RATE - 1);

/** Withholding on dividends to legal entities (the КФП line). Dividends to
 *  individuals sit inside ДДФЛ-окончателен данък and are NOT rescaled here —
 *  the UI carries that caveat. */
export const scoreDividend = (
  dividendRevenueEur: number,
  newRate: number,
): number => dividendRevenueEur * (newRate / DIVIDEND_TAX_RATE - 1);

// ---------------------------------------------------------------------------
// Bracket schedules over the fitted earnings distribution
// ---------------------------------------------------------------------------

/** One band of the discretized earnings distribution shipped in
 *  policy_baseline.json (fitted offline — see
 *  scripts/budget/earnings_distribution.ts for anchors and method). */
export interface EarningsBand {
  /** Gross monthly wage the band represents, EUR. */
  grossEur: number;
  /** Workers in the band. */
  workers: number;
}

/** Marginal PIT bracket on the monthly post-SSC taxable base. Brackets are
 *  sorted by `fromEur`; an untaxed minimum is just a leading
 *  `{fromEur: 0, rate: 0}` segment. */
export interface PitBracket {
  fromEur: number;
  rate: number;
}

/** Marginal tax on one monthly taxable base. */
export const pitMonthlyUnderBrackets = (
  baseEur: number,
  brackets: PitBracket[],
): number => {
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const from = brackets[i].fromEur;
    const to = i + 1 < brackets.length ? brackets[i + 1].fromEur : Infinity;
    if (baseEur <= from) break;
    tax += brackets[i].rate * (Math.min(baseEur, to) - from);
  }
  return tax;
};

/** Annual employment-PIT revenue the band grid yields under a bracket
 *  schedule (employee profile: SSC on the capped base, no child relief). */
export const pitRevenueOnBands = (
  bands: EarningsBand[],
  capEur: number,
  brackets: PitBracket[],
): number => {
  let total = 0;
  for (const b of bands) {
    const base = b.grossEur - SSC_EMPLOYEE_RATE * Math.min(b.grossEur, capEur);
    total += b.workers * pitMonthlyUnderBrackets(Math.max(0, base), brackets);
  }
  return total * 12;
};

/** Score a bracket schedule for the EMPLOYMENT portion of ДДФЛ: Δ vs the
 *  current flat rate, computed on the same grid so discretization error
 *  cancels, scaled by κ (the grid's calibration to the НАП-anchored
 *  employment revenue). Non-employment income is scored separately by the
 *  caller (it scales with the schedule's base rate). */
export const scorePitSchedule = (
  bands: EarningsBand[],
  capEur: number,
  brackets: PitBracket[],
  kappa: number,
  flatRate: number = PIT_RATE,
): number => {
  const flat: PitBracket[] = [{ fromEur: 0, rate: flatRate }];
  return (
    kappa *
    (pitRevenueOnBands(bands, capEur, brackets) -
      pitRevenueOnBands(bands, capEur, flat))
  );
};

/** Weighted Gini coefficient of a per-band money amount (e.g. net monthly
 *  income under a schedule). O(n²) pairwise — trivial at ~120 bands. Wage
 *  earners only, by construction of the band grid. */
export const giniOnBands = (
  bands: EarningsBand[],
  amountOf: (grossEur: number) => number,
): number => {
  let totalW = 0;
  let mean = 0;
  const xs = bands.map((b) => {
    totalW += b.workers;
    const x = amountOf(b.grossEur);
    mean += b.workers * x;
    return x;
  });
  mean /= totalW;
  if (mean <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < bands.length; i++) {
    for (let j = 0; j < bands.length; j++) {
      sum += bands[i].workers * bands[j].workers * Math.abs(xs[i] - xs[j]);
    }
  }
  return sum / (2 * totalW * totalW * mean);
};

export interface ModCapBandsResult {
  /** Δ insurable base, EUR/yr (negative when the cap is lowered). */
  deltaBaseEur: number;
  /** Δ contributions reaching the budget. */
  sscEur: number;
  /** PIT offset: a higher insurable base means more SSC deducted from the
   *  PIT base, so PIT moves opposite to contributions. */
  pitOffsetEur: number;
  totalEur: number;
}

/** Score a cap move over the band grid — works in BOTH directions, because
 *  the fitted distribution provides the below-cap density the aggregate
 *  identity alone couldn't see. `pitBaseRate` is the schedule's base PIT
 *  rate, for the deduction interaction. */
export const scoreModCapBands = (
  bands: EarningsBand[],
  fromCapEur: number,
  toCapEur: number,
  pitBaseRate: number = PIT_RATE,
): ModCapBandsResult => {
  let deltaBaseEur = 0;
  for (const b of bands) {
    deltaBaseEur +=
      b.workers *
      (Math.min(b.grossEur, toCapEur) - Math.min(b.grossEur, fromCapEur));
  }
  deltaBaseEur *= 12;
  const sscEur = deltaBaseEur * SSC_COMBINED_BUDGET_RATE;
  const pitOffsetEur = -deltaBaseEur * SSC_EMPLOYEE_RATE * pitBaseRate;
  return {
    deltaBaseEur,
    sscEur,
    pitOffsetEur,
    totalEur: sscEur + pitOffsetEur,
  };
};

// ---------------------------------------------------------------------------
// МОД cap (максимален осигурителен доход)
// ---------------------------------------------------------------------------

/** Aggregates recovered by the PIT-vs-insurable-base identity (assembled in
 *  run_policy_baseline.ts; method documented in __smoke_mod_identity.ts). */
export interface ModIdentity {
  /** Wage mass above the cap, EUR/yr. */
  aboveCapMassEur: number;
  /** The cap the identity was computed against, EUR/mo. */
  capEur: number;
  /** Pareto tail-index band: the 2025 legislated raise backtests against
   *  МФ's own estimate at ~2.4; the band spans the plausible range. */
  alphaLow: number;
  alphaCentral: number;
  alphaHigh: number;
}

/** Combined employer+employee contribution rate that reaches the
 *  consolidated budget (statutory ~32.8% minus the 5pp second pillar). */
export const SSC_COMBINED_BUDGET_RATE = 0.278;

export interface ModCapResult {
  lowEur: number;
  centralEur: number;
  highEur: number;
}

/** Score raising the cap to C′ (pass Infinity for "no cap"). Under a
 *  Pareto(α) tail anchored at the identity's vintage cap C, the mass newly
 *  insured by a cap x is E·(1 − (C/x)^(α−1)); the score is the INCREMENT
 *  from `fromCapEur` (the cap in force today — the identity year's cap may
 *  be older) to C′, taxed at the combined budget rate. Lowering the cap
 *  needs the below-cap density, which the identity can't see — callers keep
 *  C′ ≥ fromCapEur. */
export const scoreModCap = (
  identity: ModIdentity,
  newCapEur: number,
  fromCapEur: number = identity.capEur,
): ModCapResult => {
  const covered = (alpha: number, cap: number): number =>
    cap === Infinity
      ? 1
      : 1 -
        Math.pow(identity.capEur / Math.max(cap, identity.capEur), alpha - 1);
  const delta = (alpha: number): number =>
    Math.max(0, covered(alpha, newCapEur) - covered(alpha, fromCapEur));
  const score = (alpha: number): number =>
    identity.aboveCapMassEur * delta(alpha) * SSC_COMBINED_BUDGET_RATE;
  // A heavier tail (lower α) parks more of the mass far above any finite
  // cap, so it yields LESS from a finite raise — α order flips low/high.
  return {
    lowEur: score(identity.alphaLow),
    centralEur: score(identity.alphaCentral),
    highEur: score(identity.alphaHigh),
  };
};
