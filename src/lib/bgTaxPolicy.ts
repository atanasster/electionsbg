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

/** Statutory employer SSC rate paid on top of the gross salary (~19.02%,
 *  2026). The budget funds this on the public wages it pays and collects it
 *  on private ones. */
export const EMPLOYER_SSC_RATE = 0.1902;

/** Fraction of a GROSS SALARY the consolidated budget collects back as
 *  PIT + SSC: the combined budget contribution rate plus flat PIT on the
 *  post-SSC base (≈ 36.4%). This is the mechanical, first-round labour-tax
 *  feedback shared by EVERY lever that moves wage income — administration
 *  cuts, public-wage indexation, the teachers' peg, maternity return-to-work.
 *  Under the consolidated (КФП) frame the employer SSC nets out (the budget
 *  both pays it as cost and receives it as revenue), so applying this to a
 *  labour-cost change leaves exactly the genuine net cost/saving. It is NOT
 *  the Tier-2 demand multiplier — it is the certain accounting offset; the
 *  multiplier rides on the resulting net impulse on top (no double count). */
export const labourTaxFeedbackOnSalary = (grossSalaryEur: number): number =>
  grossSalaryEur *
  (SSC_COMBINED_BUDGET_RATE + (1 - SSC_EMPLOYEE_RATE) * PIT_RATE);

/** The same feedback per unit of total LABOUR COST (gross salary + employer
 *  SSC): cost = salary·(1+employer) ⇒ salary = cost/(1+employer). ≈ 30.6% of
 *  labour cost. */
export const labourTaxFeedbackOnCost = (labourCostEur: number): number =>
  labourTaxFeedbackOnSalary(labourCostEur / (1 + EMPLOYER_SSC_RATE));

/** Employee share of the 8% health contribution (ЗЗО чл.40 — employer 4.8% /
 *  employee 3.2% = 60/40). Only the employee's own share is deductible from
 *  their PIT base. */
export const HEALTH_EMPLOYEE_SHARE = 0.4;

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

// ---------------------------------------------------------------------------
// Expenditure side — pension indexation, administration headcount, МРЗ
// ---------------------------------------------------------------------------

export interface PensionBaseline {
  massEur: number;
  supplementMassEur: number;
  cpiPct: number;
  wageGrowthPct: number;
}

export interface PensionPolicy {
  /** Weight on CPI in the indexation blend (current law: 0.5). The income
   *  weight is 1 − cpiWeight. */
  cpiWeight: number;
  /** Whether the COVID-supplement slice of the base is indexed too
   *  (current practice: yes). */
  indexSupplement: boolean;
  /** Rounds of July indexation to accumulate (1 = next budget year). */
  horizonYears: number;
}

export const PENSION_POLICY_CURRENT: PensionPolicy = {
  cpiWeight: 0.5,
  indexSupplement: true,
  horizonYears: 1,
};

/** Annual indexation rate (fraction) a policy yields from the Swiss-rule
 *  inputs. */
export const pensionIndexationRate = (
  b: PensionBaseline,
  cpiWeight: number,
): number => (cpiWeight * b.cpiPct + (1 - cpiWeight) * b.wageGrowthPct) / 100;

/** Δ pension expenditure of a policy vs current law, EUR/yr at the horizon.
 *  Static: same inputs every round (no feedback into wages/CPI), compounding
 *  on the respective base. Negative = the budget spends less. */
export const scorePensionIndexation = (
  b: PensionBaseline,
  policy: PensionPolicy,
): number => {
  const grow = (
    mass: number,
    supplement: number,
    rate: number,
    indexSupplement: boolean,
    years: number,
  ): number => {
    // The supplement slice stays nominal when excluded from indexation.
    let indexed = mass - supplement;
    for (let i = 0; i < years; i++) indexed *= 1 + rate;
    let supp = supplement;
    if (indexSupplement) for (let i = 0; i < years; i++) supp *= 1 + rate;
    return indexed + supp;
  };
  const current = grow(
    b.massEur,
    b.supplementMassEur,
    pensionIndexationRate(b, PENSION_POLICY_CURRENT.cpiWeight),
    PENSION_POLICY_CURRENT.indexSupplement,
    policy.horizonYears,
  );
  const scenario = grow(
    b.massEur,
    b.supplementMassEur,
    pensionIndexationRate(b, policy.cpiWeight),
    policy.indexSupplement,
    policy.horizonYears,
  );
  return scenario - current;
};

export interface AdminBaseline {
  positionsTotal: number;
  positionsVacant: number;
  payrollEur: number;
  coveredHeadcount: number;
}

export interface AdminCutResult {
  /** Gross payroll saving, EUR/yr (national extrapolation). */
  grossEur: number;
  /** PIT + SSC the budget stops collecting from the cut salaries. */
  revenueFeedbackEur: number;
  /** Net budget effect (negative = saving) after the feedback. */
  netEur: number;
  /** Share of the cut absorbed by vacant positions (saves nothing). */
  vacantAbsorbedShare: number;
  /** Positions actually laid off. */
  positionsCut: number;
}

/** Score cutting `cutShare` of administration positions. Vacant positions
 *  absorb cuts first — they are budgeted but largely unspent, so eliminating
 *  them saves ≈ nothing in cash terms. Real layoffs save the full labour
 *  cost but return PIT + the employee/employer contributions to neither side
 *  (the budget loses that revenue), so the net saving is materially smaller
 *  than the headline. */
export const scoreAdminCut = (
  b: AdminBaseline,
  cutShare: number,
): AdminCutResult => {
  const costPerFte = b.payrollEur / b.coveredHeadcount;
  const cutPositions = b.positionsTotal * cutShare;
  const vacantAbsorbed = Math.min(cutPositions, b.positionsVacant);
  const realLayoffs = cutPositions - vacantAbsorbed;
  const grossEur = realLayoffs * costPerFte;
  // The labour cost splits ~ gross salary + employer SSC; the budget loses
  // employee+employer SSC and PIT on those salaries — the shared labour-tax
  // feedback (cost = salary × (1 + employer), feedback = salary × combined
  // budget SSC + PIT on the post-SSC base).
  const revenueFeedbackEur = labourTaxFeedbackOnCost(grossEur);
  return {
    grossEur,
    revenueFeedbackEur,
    netEur: -(grossEur - revenueFeedbackEur),
    vacantAbsorbedShare: cutPositions > 0 ? vacantAbsorbed / cutPositions : 0,
    positionsCut: Math.round(cutPositions),
  };
};

export interface MinWageBaseline {
  currentEur: number;
  formulaEur: number;
}

/** Δ budget revenue of freezing МРЗ instead of applying the КТ чл.244
 *  formula: every worker the formula would lift to the new floor keeps the
 *  lower wage, so the budget loses the SSC + PIT on the difference. Scored
 *  over the band grid (the model's compressed lower half IS the floor).
 *  Negative = revenue loss vs the formula path. */
export const scoreMinWageFreeze = (
  bands: EarningsBand[],
  b: MinWageBaseline,
): number => {
  let deltaWageMass = 0;
  for (const band of bands) {
    if (band.grossEur >= b.formulaEur) continue;
    // Under the formula, wages below the new floor rise to it (those already
    // above the current floor but below the new one rise by the gap).
    const lifted = Math.max(band.grossEur, b.currentEur);
    deltaWageMass += band.workers * (b.formulaEur - lifted);
  }
  deltaWageMass *= 12;
  // Freezing forgoes contributions + PIT on that mass.
  return -(
    deltaWageMass * SSC_COMBINED_BUDGET_RATE +
    deltaWageMass * (1 - SSC_EMPLOYEE_RATE) * PIT_RATE
  );
};

// ---------------------------------------------------------------------------
// Phase 5 levers — wage indexation, defense target, capital, self-paid SSC,
// health contribution
// ---------------------------------------------------------------------------

/** Δ spending of indexing the consolidated Персонал line by `pct` percent
 *  (positive = more spending), NET of the labour-tax feedback. With
 *  `onlyNonExempt`, restraint-exempt sectors (военни/полицаи/лекари/учители —
 *  `exemptShare` of the line) keep their path and only the rest is indexed.
 *  The budget collects ~30.6% of the indexed cost straight back as PIT + SSC
 *  (the same mechanical offset scoreAdminCut nets on a cut), so the net cost
 *  is materially below the gross — the Персонал line already carries the
 *  employer SSC, hence labourTaxFeedbackOnCost (not …OnSalary). */
export const scoreWageIndexation = (
  personnelMassEur: number,
  exemptShare: number,
  pct: number,
  onlyNonExempt: boolean,
): number => {
  const grossCostEur =
    personnelMassEur * (onlyNonExempt ? 1 - exemptShare : 1) * (pct / 100);
  return grossCostEur - labourTaxFeedbackOnCost(grossCostEur);
};

/** Δ spending of moving NATO-definition defense from its current % of GDP
 *  to `targetPct`, priced against the projected-year GDP. */
export const scoreDefenseTarget = (
  gdpEur: number,
  currentPct: number,
  targetPct: number,
): number => ((targetPct - currentPct) / 100) * gdpEur;

/** CASH Δ of changing planned capital expenditure by `pct` percent: the
 *  historical execution rate scales it — plans that would not have been
 *  executed cost (or save) nothing when cut on paper. */
export const scoreCapitalChange = (
  planEur: number,
  executionRate: number,
  pct: number,
): number => planEur * (pct / 100) * executionRate;

/** Budget saving if the budget-paid categories (КСО чл. 6, ал. 5: държавни
 *  служители, съдебна власт, военни, МВР и специалните служби — today the
 *  budget pays both contribution shares for all of them) take over the
 *  STANDARD employee share (13.78%; the elevated special-category pension
 *  rates stay budget-paid either way). `grossUp` models the realistic
 *  compensating salary increase — which makes the reform fiscally neutral.
 *  Net saving = employee share of the wage bill, minus the PIT the budget
 *  loses because contributions become deductible from those salaries
 *  (today their ЗДДФЛ base is the FULL gross — nothing is withheld for
 *  their account, so nothing is deductible; ЗДДФЛ чл. 25, ал. 1). */
export const scoreSscSelfPaid = (
  count: number,
  avgWageEur: number,
  grossUp: boolean,
): number => {
  if (grossUp) return 0;
  const wageBill = count * avgWageEur * 12;
  return -(wageBill * SSC_EMPLOYEE_RATE * (1 - PIT_RATE));
};

/** Δ revenue of moving the health-contribution rate by `pp` percentage
 *  points, collected on the insurable base, NET of the PIT the budget gives
 *  back: the employee's share of the extra contribution (≈40%) is deductible
 *  from their PIT base, so PIT falls a little — the same deduction interaction
 *  the МОД lever's pitOffset models. Small (~4% of the gross), but kept for
 *  consistency. */
export const scoreHealthContribution = (
  insurableBaseEur: number,
  pp: number,
): number => {
  const contributionEur = insurableBaseEur * (pp / 100);
  const pitOffsetEur = contributionEur * HEALTH_EMPLOYEE_SHARE * PIT_RATE;
  return contributionEur - pitOffsetEur;
};

// ---------------------------------------------------------------------------
// Pension floor (минимална пенсия) + teachers' 125% pay peg
// ---------------------------------------------------------------------------

/** One band of the НОИ pensioner distribution by basic monthly pension
 *  (quarterly statistical bulletin, sheet "grupiosn (2)"), shipped in
 *  policy_baseline.json. Only the bands the floor slider can reach. */
export interface PensionFloorBand {
  /** Upper edge of the band, EUR/month. */
  upToEur: number;
  /** Pensioners in the band (first pension, per-pensioner). */
  count: number;
  /** Band midpoint — the representative basic pension, EUR/month. */
  midEur: number;
}

/** Δ pension spending of raising the minimum pension to `newMinEur`
 *  (EUR/yr, positive = the budget spends more). Top-up mechanics: the
 *  effective payment is max(pension, minimum), so pensioners at or below
 *  the CURRENT minimum already sit at it via доплащане — raising the floor
 *  to M costs (M − max(bandMid, currentMin))₊ per head. Band-midpoint
 *  grain; validated against НОИ's published top-up cost in
 *  run_policy_baseline.ts (warn-level — see the gate there). */
export const scorePensionFloorRaise = (
  bands: PensionFloorBand[],
  currentMinEur: number,
  newMinEur: number,
): number => {
  if (newMinEur <= currentMinEur) return 0;
  let monthlyEur = 0;
  for (const b of bands) {
    const effective = Math.max(b.midEur, currentMinEur);
    if (effective < newMinEur) monthlyEur += b.count * (newMinEur - effective);
  }
  return monthlyEur * 12;
};

/** Δ spending of pegging teachers' pay to `targetPct`% of the economy-wide
 *  average wage (the "125% policy"): count × economy wage × the ratio gap,
 *  grossed up by the ~19.02% employer contributions the budget also pays,
 *  then NET of the labour-tax feedback the budget collects on the higher pay
 *  (~30.6% — the same offset scoreAdminCut/scoreWageIndexation apply).
 *  `currentRatio` is the education-public-sector wage over the economy
 *  average — a proxy for teachers proper (it includes non-teaching staff;
 *  the UI captions that). Negative = a saving (targets below the current
 *  ratio are allowed — it is a simulator). */
export const scoreTeachersPeg = (
  count: number,
  economyWageEur: number,
  currentRatio: number,
  targetPct: number,
): number => {
  const grossCostEur =
    count *
    economyWageEur *
    (targetPct / 100 - currentRatio) *
    (1 + EMPLOYER_SSC_RATE);
  return grossCostEur - labourTaxFeedbackOnCost(grossCostEur);
};

// ---------------------------------------------------------------------------
// June-2026 consolidation-debate levers. These three carry their own sourced
// constants instead of riding policy_baseline.json — each is a single
// published figure, not a pipeline-derived aggregate.
// ---------------------------------------------------------------------------

/** Second-year child-raising benefit (чл.53 КСО): 2025 НОИ execution
 *  €154.2M/yr at €398.81/mo (frozen by the extension law). The 2→1-year cut
 *  was floated by a ПБ MP on 2026-06-01 and officially denied the same day —
 *  the lever prices the recurring debate, not a government bill. */
export const MATERNITY_Y2_SPEND_EUR = 154_200_000;
export const MATERNITY_Y2_MONTHS = 12;
/** Flat second-year benefit, EUR/mo (КСО чл.53 — frozen by the extension
 *  law). Recipient-months/yr = spend ÷ this, the base the behavioral
 *  return-to-work recapture scales (bgBehavioral.maternityReturnOffset). */
export const MATERNITY_Y2_BENEFIT_EUR_MO = 398.81;

/** Δ spending of keeping only `monthsKept` of the paid second year
 *  (negative = the budget saves). Static: ignores the contributions and
 *  income tax of mothers returning to work earlier (a partial offset in
 *  the budget's favour) and the 50%-benefit-if-working rule. */
export const scoreMaternityMonths = (monthsKept: number): number =>
  -MATERNITY_Y2_SPEND_EUR *
  ((MATERNITY_Y2_MONTHS - monthsKept) / MATERNITY_Y2_MONTHS);

/** MP pay mass: 240 MPs × €4,236/mo base (3× the NSI public-sector average
 *  wage, March 2026 — the level the 2026-06-11 freeze decision anchors to)
 *  × ~1.30 average committee extras × 12 × 1.1902 employer SSC ≈ €18.9M/yr.
 *  The representation allowance is excluded (non-wage). */
export const MP_PAY_MASS_EUR = 18_900_000;

/** Δ spending of freezing MP pay instead of the quarterly re-indexation
 *  (negative = saving): one year of foregone growth on the pay mass. The
 *  president (2× MP base), НС chair, PM and ministers ride the same base,
 *  so the true saving is somewhat larger — captioned in the UI, not
 *  modeled (their count is small and their extras differ). */
export const scoreMpPayFreeze = (wageGrowthPct: number): number =>
  -MP_PAY_MASS_EUR * (wageGrowthPct / 100);

/** Party subsidies: ~2.86M subsidized votes (€11.7M envelope ÷ €4.09/vote,
 *  7 qualifying formations after April 2026); current law is €3.00/vote
 *  since 30.04.2026 (adopted 2026-06-03, cut from €4.09 = 8 лв). */
export const PARTY_SUBSIDY_VOTES = 2_861_000;
export const PARTY_SUBSIDY_RATE_EUR = 3.0;

/** Δ spending of setting the per-vote subsidy (positive = costs more than
 *  current law). */
export const scorePartySubsidy = (rateEur: number): number =>
  (rateEur - PARTY_SUBSIDY_RATE_EUR) * PARTY_SUBSIDY_VOTES;

// ---------------------------------------------------------------------------
// Excise duties (акцизи) — fuel / energy, tobacco, alcohol, and the currently
// zero-rated wine base. The fuel/tobacco/alcohol levers move the EXISTING rate
// by a percentage (the categories carry many sub-rates — petrol/diesel/LPG,
// specific+ad-valorem on tobacco — so a single €/unit slider would be
// meaningless; a uniform "% change to the rate" is the honest, legible unit).
// Revenue anchors are the Агенция "Митници" annual chronicle category lines
// (data/budget/revenue_breakdown/customs/<year>.json), threaded through the
// policy baseline's revenue block. The demand/cross-border/illicit response is
// applied as a separate behavioral offset (see bgBehavioral.ts), so these are
// the FIXED-base static deltas: a +g change to a category raising R today
// raises R·g before any behavioural leakage.
// ---------------------------------------------------------------------------

/** Δ revenue of changing an excise category's rate by `rateChangeFraction`
 *  (+0.10 = +10%), holding the consumption base fixed: R·g. Behaviour
 *  (demand elasticity + cross-border/illicit substitution) is layered on top
 *  in the dynamic engine. */
export const scoreExcise = (
  exciseRevenueEur: number,
  rateChangeFraction: number,
): number => exciseRevenueEur * rateChangeFraction;

/** Commercial wine volume that an introduced excise would realistically reach,
 *  hectolitres/year. Total BG wine consumption is ≈1.15M hl (ИАЛВ: 110–120M L,
 *  ~90% domestic; cross-checked vs OIV 114,000 t for 2023). A large home-
 *  produced / off-survey slice escapes any excise (the NSI household survey
 *  reports only ~4.7 L/capita vs the ~18 L/capita implied total), so the
 *  taxable commercial base is set to the lower commercial-market figure
 *  (~0.94M hl, USDA-FAS). The residual demand/home-shift response rides the
 *  behavioral leakage term. */
export const WINE_TAXABLE_HL = 940_000;

/** Δ revenue of INTRODUCING a still-wine excise at `rateEurPerHl` (BG taxes
 *  wine at €0 today — the EU minimum is also €0, so this is a genuine, EU-legal
 *  policy choice rather than a rate tweak). Reference points: France €4.05/hl
 *  (token), Netherlands ≈€48/hl. Static = rate × commercial base. */
export const scoreWineExcise = (rateEurPerHl: number): number =>
  rateEurPerHl * WINE_TAXABLE_HL;

// ---------------------------------------------------------------------------
// Gambling — the ЗХ "two-component fee" variable rate on gross gaming revenue
// (GGR = stakes minus payouts) for betting / lottery / toto / online. Modeled
// as a single rate lever on the GGR base. Unlike the excise anchors this is
// NOT a standalone КФП line — gambling is an alternative tax folded into
// "Корпоративен данък"/"Други данъци" + ЗХ fees — so the base is industry/НАП-
// reported, not a published budget line (caveat surfaced in the UI). The fixed
// per-machine/per-table ЗКПО tax is deliberately NOT modeled (a count×fee lever
// with a rough device-count anchor). Behaviour = migration of licensed GGR to
// unlicensed/offshore operators (the 2013 turnover-tax episode is the cautionary
// tale), applied as a separate offset in bgBehavioral.ts.
// ---------------------------------------------------------------------------

/** Bulgarian gross gaming revenue (GGR, stakes − payouts), €/yr. ~1.4B BGN in
 *  2025 (online GGR alone > 1B BGN); НАП/industry-reported, NOT a budget line —
 *  medium confidence. The base the ЗХ variable fee is levied on. */
export const GAMBLING_GGR_EUR = 716_000_000;

/** Current-law ЗХ variable-component rate on GGR. Raised 20% → 25% effective
 *  2026-01-01 (Budget 2026); 25% is the "no change" lever position. */
export const GAMBLING_GGR_FEE_RATE = 0.25;

/** Δ revenue of setting the ЗХ GGR fee to `newRate` (fraction, e.g. 0.30),
 *  holding GGR fixed: GGR × (newRate − current). Offshore/illicit migration of
 *  the base is layered on as a behavioral offset. */
export const scoreGamblingGgr = (newRate: number): number =>
  GAMBLING_GGR_EUR * (newRate - GAMBLING_GGR_FEE_RATE);
