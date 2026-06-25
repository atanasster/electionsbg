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
import { BGN_PER_EUR } from "./currency";

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
  /** Share of the below-formula wage-uplift mass earned in the budget sector
   *  (държавна администрация, образование, здравеопазване, МВР/отбрана,
   *  общински дейности). For these workers the budget itself pays the wage,
   *  so freezing them is a payroll SAVING; for the private remainder it is a
   *  pure SSC/PIT loss. A documented assumption — not derivable from the
   *  personnel file (which covers only the civil service) — see
   *  run_policy_baseline.ts. */
  publicSectorShare: number;
}

export interface MinWageFreezeResult {
  /** SSC + PIT the budget forgoes on the PRIVATE below-floor uplift it would
   *  have collected under the formula (negative — a revenue loss). */
  privateRevenueLossEur: number;
  /** Net payroll the budget avoids paying its OWN below-floor workers: the
   *  gross uplift + employer SSC it does not disburse, less the labour-tax
   *  that flows straight back to it (positive — a genuine saving). */
  publicPayrollSavingEur: number;
  /** Net budget effect, private loss + public saving (sign follows the
   *  expenditure-balance convention: positive = the budget improves). */
  netEur: number;
  /** Forgone gross ANNUAL wage uplift the КТ чл.244 formula would have paid,
   *  EUR — the common base both channels are scored on. */
  upliftMassEur: number;
}

/** Budget effect of freezing МРЗ instead of applying the КТ чл.244 formula.
 *  Every worker the formula would lift to the new floor keeps the lower wage;
 *  the budget effect splits by who pays that wage:
 *    • PRIVATE workers — the budget never paid them, so freezing only forgoes
 *      the SSC + PIT the higher wage would have generated (a revenue loss).
 *    • PUBLIC workers — the budget pays their wage (gross + employer SSC), so
 *      freezing avoids that labour cost, net of the same SSC + PIT that flows
 *      straight back to it (a genuine saving — the mechanical offset every
 *      public-wage lever nets via labourTaxFeedbackOnCost).
 *  Scored over the band grid (the model's compressed lower half IS the floor).
 *  With publicSectorShare = 0 this collapses to the old revenue-only result. */
export const scoreMinWageFreeze = (
  bands: EarningsBand[],
  b: MinWageBaseline,
): MinWageFreezeResult => {
  let deltaWageMass = 0;
  for (const band of bands) {
    if (band.grossEur >= b.formulaEur) continue;
    // Under the formula, wages below the new floor rise to it (those already
    // above the current floor but below the new one rise by the gap).
    const lifted = Math.max(band.grossEur, b.currentEur);
    deltaWageMass += band.workers * (b.formulaEur - lifted);
  }
  deltaWageMass *= 12;
  const publicMass = deltaWageMass * b.publicSectorShare;
  const privateMass = deltaWageMass - publicMass;
  // Private: freezing forgoes the contributions + PIT on the uplift.
  const privateRevenueLossEur = -labourTaxFeedbackOnSalary(privateMass);
  // Public: the budget avoids the full labour cost (gross + employer SSC) of
  // the uplift it would otherwise have paid, net of the tax it claws back.
  const publicLabourCostEur = publicMass * (1 + EMPLOYER_SSC_RATE);
  const publicPayrollSavingEur =
    publicLabourCostEur - labourTaxFeedbackOnCost(publicLabourCostEur);
  return {
    privateRevenueLossEur,
    publicPayrollSavingEur,
    netEur: privateRevenueLossEur + publicPayrollSavingEur,
    upliftMassEur: deltaWageMass,
  };
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
// Excise duties (акцизи) — per-product ABSOLUTE rates so each lever shows the
// real rate (in its real unit) and carries an EU-country comparator, like the
// VAT/PIT/corp levers. Modeled per dominant product: diesel & petrol (€/1000 L),
// cigarettes (€/1000), spirits (€/hl pure alcohol), and the currently zero-rated
// wine (€/hl, introduced from 0). Revenue anchors are the Агенция "Митници"
// annual chronicle lines (data/budget/revenue_breakdown/customs/<year>.json):
// diesel/petrol are itemised; the cigarette rate scales the whole tobacco line
// (cigarettes dominate it) and the spirits rate scales the spirits share of the
// combined alcohol line (the chronicle does not split spirits from beer). The
// demand/cross-border/illicit response is a separate behavioral offset (see
// bgBehavioral.ts), so these are FIXED-base static deltas.
// ---------------------------------------------------------------------------

/** Current-law BG rates (the slider defaults — at these the lever Δ is 0).
 *  PwC, 30 Jan 2026: diesel €330.29/1000 L, petrol €363.02/1000 L, spirits
 *  €562.43/hl PA (EU floors €330 / €359 / €550); cigarettes min total
 *  €113.51/1000 (EU floor €90 + ≥60% WAP). Rounded to the integer slider grid. */
export const EXCISE_DIESEL_RATE = 330;
export const EXCISE_PETROL_RATE = 363;
export const EXCISE_CIGARETTE_RATE = 114;
export const EXCISE_SPIRITS_RATE = 562;

/** Spirits share of the combined alcohol excise line (~€141M of €177M; beer is
 *  the rest, wine is €0). The chronicle reports alcohol as one line, so the
 *  spirits base is estimated as this share. Research: beer ≈ €36M (≈0.9% of all
 *  excise), spirits ≈ €141M. */
export const SPIRITS_SHARE_OF_ALCOHOL = 0.8;

/** Δ revenue of moving an excise rate from its current level to `newRate`,
 *  holding the physical base fixed: R × (newRate / currentRate − 1) — the same
 *  scaling form as corporate tax. Behaviour (demand + cross-border/illicit
 *  substitution) is layered on top in the dynamic engine. */
export const scoreExciseRate = (
  exciseRevenueEur: number,
  currentRate: number,
  newRate: number,
): number =>
  currentRate <= 0 ? 0 : exciseRevenueEur * (newRate / currentRate - 1);

/** Δ revenue of a category-level excise rate change by `rateChangeFraction`
 *  (+0.10 = +10%): R·g. Retained for the AI chat tool, which models excise as
 *  a whole-category percentage move (the simulator UI uses per-product absolute
 *  rates via scoreExciseRate). */
export const scoreExcise = (
  exciseRevenueEur: number,
  rateChangeFraction: number,
): number => exciseRevenueEur * rateChangeFraction;

// ---------------------------------------------------------------------------
// ЗАДС cigarette excise CALENDAR — total-minimum excise, BGN per 1000 cigarettes.
// The binding figure for the mass-market price segment (the specific component
// 134.5→143 BGN and the ad-valorem 20.5%→19% of retail both fold into this
// floor). Post the May-2025 ЗИД ЗАДС amendment: 210 BGN from 01.05.2025, rising
// +12 BGN/yr through 2029. Sources: businessnovinite / financialtribune / 24chasa
// (the 4-yr plan + the May-2025 acceleration); PwC 2026 puts the floor at
// €113.51/1000 ≈ the 2026 222-BGN level ≈ EXCISE_CIGARETTE_RATE (114, the
// rounded integer slider default).
//   2025 210 · 2026 222 · 2027 234 · 2028 246 · 2029 258  (÷ BGN_PER_EUR → €/1000)
export const CIGARETTE_EXCISE_CALENDAR_BGN: Record<number, number> = {
  2025: 210,
  2026: 222,
  2027: 234,
  2028: 246,
  2029: 258,
};

/** Total-minimum cigarette excise for a calendar `year`, €/1000 (the unit
 *  EXCISE_CIGARETTE_RATE uses). Falls back to the current slider default for
 *  years outside the published calendar. */
export const cigaretteExciseRateEur = (year: number): number => {
  const bgn = CIGARETTE_EXCISE_CALENDAR_BGN[year];
  return bgn === undefined ? EXCISE_CIGARETTE_RATE : bgn / BGN_PER_EUR;
};

/** ЗДБРБ-2026 ACCELERATES the calendar from 01.08.2026 ("намаляват се периодите
 *  за достигане на нивата на акцизни ставки"). The one-step reading — pull the
 *  next scheduled +12-BGN level (the 2027 step, 234 BGN ≈ €119.64/1000) forward
 *  to mid-2026. The exact figure lives in the accompanying ЗИД ЗАДС annex; this
 *  constant is flagged as that one-step interpretation. */
export const CIGARETTE_ACCELERATED_2026_BGN =
  CIGARETTE_EXCISE_CALENDAR_BGN[2027];
export const cigaretteAcceleratedRateEur = (): number =>
  CIGARETTE_ACCELERATED_2026_BGN / BGN_PER_EUR;

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
 *  policy choice rather than a rate tweak). Reference points: France €4/hl
 *  (token), Netherlands €88/hl, Ireland €425/hl (EU's highest). Static = rate ×
 *  commercial base. */
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

// ---------------------------------------------------------------------------
// Road charges — е-винетки (cars ≤3.5t) + тол (per-km, heavy vehicles), which
// АПИ collects via Национално тол управление into the republican budget.
// Modeled as a single lever: a uniform % uplift on the combined road-charge
// revenue base. Like gambling, the base is an administrative АПИ/НТУ figure,
// not a standalone КФП tax line, so it's hardcoded here rather than read from
// the КФП-derived baseline. Behaviour (heavy-vehicle cross-border diversion;
// car vignettes are near-inelastic) is a Tier-1 offset in bgBehavioral.ts.
// ---------------------------------------------------------------------------

/** Combined АПИ road-charge revenue (е-винетки + тол + маршрутни карти), €/yr.
 *  2025: ≈ €562M (~1.1B BGN, АПИ); 2024 was 899M BGN = €459.7M, split ≈ €144M
 *  e-vignettes + €302M toll. Paid into the republican budget via НТУ. */
export const ROAD_CHARGES_BASE_EUR = 562_000_000;

/** Δ revenue of a uniform `pctChange` move on the WHOLE combined road base.
 *  @deprecated Not on any production path — the UI and the AI chat tool both
 *  moved to the per-component split (`scoreRoadComponentUplift`). Retained only
 *  as the combined-base reference and exercised by `__test_engine.ts`; do not
 *  treat it as live. The government's vignette-only +30% (≈€53M) is a SUBSET of
 *  what this returns (≈€169M). */
export const scoreRoadCharges = (pctChange: number): number =>
  ROAD_CHARGES_BASE_EUR * pctChange;

// ---------------------------------------------------------------------------
// Road-charge component split — vignette vs тол vs маршрутни карти.
// The combined `scoreRoadCharges` over-prices a vignette-ONLY measure (a +30%
// uplift hits the whole €562M base instead of just the e-vignette slice). The
// ЗДБРБ-2026 measure raises *vignettes* by 30% while the тол increase was a
// separate, earlier two-stage 2025 step — so an honest read needs the slice.
//
// Split anchor: АПИ's 2024 outturn of €459.7M decomposed to ≈€144M e-vignettes
// + €302M тол + ≈€13.7M маршрутни/permits (the figures the ROAD_CHARGES_BASE_EUR
// comment already cites), held as shares and re-applied to the 2025 base.
//   vignette 144/459.7 = 0.3133 · тол 302/459.7 = 0.6570 · permits 0.0298
// NOTE: only the vignette + тол shares are modeled — they DELIBERATELY sum to
// ~0.97, leaving the ≈€13.7M маршрутни/permits residual UNMODELED. So
// VIGNETTE_BASE_EUR + TOLL_BASE_EUR < ROAD_CHARGES_BASE_EUR by design, and a
// legacy `?vin=` uniform uplift can no longer reach the full base (see the
// migration site in BudgetPolicySimulator.tsx).
// Cross-check: VIGNETTE_BASE_EUR × 30% ≈ €52.9M, matching the government's
// €53.3M 2026 effect (which also folds in the residual тол-tariff step) — i.e.
// the split brings the lever onto the government's own number instead of ~3×.
export const ROAD_VIGNETTE_SHARE = 144 / 459.7;
export const ROAD_TOLL_SHARE = 302 / 459.7;
export const VIGNETTE_BASE_EUR = ROAD_CHARGES_BASE_EUR * ROAD_VIGNETTE_SHARE;
export const TOLL_BASE_EUR = ROAD_CHARGES_BASE_EUR * ROAD_TOLL_SHARE;

/** Δ revenue of a `pctChange` uplift applied to ONE road-charge component
 *  (`"vignette"` | `"toll"`): slice × pctChange. The vignette slice is the
 *  near-inelastic one (you must hold a vignette to drive); the тол slice
 *  carries the heavy-vehicle cross-border-diversion behaviour — so pricing them
 *  apart also lets the dynamic pass apply the right elasticity to each. */
export const scoreRoadComponentUplift = (
  component: "vignette" | "toll",
  pctChange: number,
): number =>
  (component === "vignette" ? VIGNETTE_BASE_EUR : TOLL_BASE_EUR) * pctChange;

// ---------------------------------------------------------------------------
// Collection-realism lever — "по-добра събираемост".
// The ЗДБРБ-2026 consolidation leans heavily on ASSERTED collection gains that
// carry no rate change: +€200M unspecified tax collection, +€100M ДОО, plus the
// collection slice of the gambling/affiliate package. These are not free: the
// EC VAT-Gap series shows compliance closes slowly (~1pp of VTTL per good year),
// and one-year realisation of an asserted "we will collect more" line is
// historically partial. This lever does NOT invent a base — it takes the
// government's own asserted euro figure and returns the share our model treats
// as bankable in the budget year, surfacing the rest as a credibility gap.
//
// Realisation band (share of an asserted collection target banked in year 1):
//   central 0.40 · low 0.20 · high 0.60.
//   Rationale: EC VAT Gap Report (BG gap ≈ €0.8B, ~8–9% of VTTL, drifting down
//   ~1pp/yr); НАП collection-ratio improvements run incrementally, not in
//   step-changes; a mid-year (01.08) start further prorates the in-year take.
export const COLLECTION_REALISM_CENTRAL = 0.4;
export const COLLECTION_REALISM_LOW = 0.2;
export const COLLECTION_REALISM_HIGH = 0.6;

/** Bankable portion of an `assertedEur` collection target at a given
 *  `realisation` share (0..1). The shortfall (asserted − bankable) is the
 *  credibility gap the analysis reports against the government's number. */
export const scoreCollectionRealism = (
  assertedEur: number,
  realisation: number = COLLECTION_REALISM_CENTRAL,
): number => assertedEur * realisation;

// ---------------------------------------------------------------------------
// SOE-subsidy "optimisation" lever — БДЖ / НКЖИ / Български пощи.
// ЗДБРБ-2026 books €285.3M from "optimising the current AND capital subsidies
// for БДЖ, НКЖИ, Български пощи и други, incl. indexation of capital contracts".
// Two things make that number soft:
//   1. It is ~90% of the whole transport-SOE subsidy envelope — an operating-
//      subsidy cut of that size is not feasible (БДЖ/НКЖИ run public-service /
//      infrastructure contracts; the 5% subsidy raise earlier in 2026 came
//      *след протести*), so it cannot be a hard cut of the base.
//   2. The measure explicitly bundles "avoided indexation of capital contracts"
//      — a price-escalation the budget declines to pay, NOT a reduction of the
//      operating subsidy (the same trick as the €564.7M wage mechanism).
//
// Envelope anchor (medium confidence, like ROAD/GAMBLING — not a КФП line):
//   БДЖ-Пътнически ≈ €116M, НКЖИ ≈ €180M, Български пощи ≈ €20M ⇒ ≈ €316M.
//   Derived from the government's own March-2026 "5% subsidy raise" увеличение
//   of €5.825M (БДЖ) and €9.0M (НКЖИ) ÷ 0.05 ⇒ the implied bases above
//   (informiran.net / БТА, 2026-03). The realised in-year saving is the share
//   of an asserted cut that is genuinely bankable given contractual rigidity.
//
// Realisation band (share of an asserted SOE-subsidy cut banked in year 1):
//   central 0.35 · low 0.15 · high 0.55 — below the collection band because the
//   base is largely contractually committed and politically protected.
export const SOE_SUBSIDY_BASE_EUR = 316_000_000;
export const SOE_SUBSIDY_REALISM_CENTRAL = 0.35;
export const SOE_SUBSIDY_REALISM_LOW = 0.15;
export const SOE_SUBSIDY_REALISM_HIGH = 0.55;

/** Bankable portion of an asserted SOE-subsidy cut. The cut is capped at the
 *  envelope (you cannot cut more subsidy than exists), then haircut by the
 *  realisation share. The analysis reports `cutEur / SOE_SUBSIDY_BASE_EUR` as
 *  the implied share of the envelope (a sanity flag) and the shortfall as the
 *  credibility gap. */
export const scoreSoeSubsidyCut = (
  cutEur: number,
  realisation: number = SOE_SUBSIDY_REALISM_CENTRAL,
): number => Math.min(cutEur, SOE_SUBSIDY_BASE_EUR) * realisation;
