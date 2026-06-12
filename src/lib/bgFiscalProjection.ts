// Multi-year fiscal projection (to 2030) for the budget policy simulator.
// Where bgTaxPolicy.ts scores a policy's FIRST-year effect on the budget
// balance, this module rolls that effect forward: deficit path, debt stock
// and the interest bill on any new debt, under the standard EC/IMF debt-
// dynamics recursion (debt_t = debt_{t-1} − balance_t, balance = primary −
// interest, stock-flow adjustments = 0).
//
// The general-government (ESA 2010) grain is used — NOT the КФП cash grain
// of the rest of the budget screens — because the −3%/60% Maastricht
// reference values and the EC forecast are defined on it.
//
// Anchors and assumptions (each constant cites its source):
//  - 2025 outturn: НСИ April 2026 EDP notification (deficit −3.5% of GDP,
//    debt 29.9%, nominal GDP €116.0 bn).
//  - 2026–2027 baseline balance: EC Spring 2026 forecast (−4.1%, −4.3%).
//    The EC opened an excessive-deficit-procedure recommendation on
//    2026-06-03 on exactly this path; the UI carries that note.
//  - 2028–2030: no-policy-change extension — the primary balance holds its
//    2027 share of GDP, the deficit then drifts with the endogenous
//    interest bill.
//  - Interest: two-bucket model. The debt inherited from 2025 pays the
//    implicit stock rate (~3.0% — Eurostat D41PAY interest ÷ debt) and rolls
//    over at ~12%/yr (average residual maturity 8y3m per the Government
//    Debt Management Strategy 2026-2028); rolled-over and newly issued debt
//    pays the marginal rate (~3.6% — the 2025 Eurobond coupons 3.375-4.125%
//    and the May-2026 10y reopening at 4.34% bracket it).
//
// The policy delta from the simulator (year-1 EUR) is assumed to keep a
// constant share of GDP — a rate change's yield grows with its base. That
// is the same static-scoring convention as the rest of the simulator: no
// behavioral response, no fiscal multiplier feedback. Levers whose effect
// COMPOUNDS rather than scales (pension indexation) are passed separately
// as a per-year absolute path via `fixedDeltaByYearEur`.

/** One projection year, both paths. Ratios in percent of that year's GDP. */
export interface ProjectionYear {
  year: number;
  gdpEur: number;
  /** Policy delta applied this year (scenario − baseline primary), EUR. */
  policyDeltaEur: number;
  baselineBalanceEur: number;
  baselineBalancePctGdp: number;
  baselineDebtEur: number;
  baselineDebtPctGdp: number;
  baselineInterestEur: number;
  balanceEur: number;
  balancePctGdp: number;
  debtEur: number;
  debtPctGdp: number;
  interestEur: number;
  /** Macro context shown in the UI (EC Spring 2026 / АСБП extension). */
  realGrowthPct: number;
  hicpPct: number;
  unemploymentPct: number;
}

export interface FiscalProjection {
  anchorYear: number;
  /** 2025 outturn, rendered as the chart's first point (paths coincide). */
  anchor: {
    gdpEur: number;
    balanceEur: number;
    balancePctGdp: number;
    debtEur: number;
    debtPctGdp: number;
  };
  years: ProjectionYear[];
  /** Σ (scenario − baseline) interest over the horizon: the compounding
   *  cost of servicing the extra debt a deficit-widening scenario issues
   *  (negative = interest saved by a consolidating scenario). */
  extraInterestEur: number;
}

// 2025 general-government outturn — НСИ EDP notification, 2026-04-22.
const GDP_2025_EUR = 116_018_300_000;
const BALANCE_2025_EUR = -4_113_000_000;
const DEBT_2025_EUR = 34_635_000_000;

// EC Spring 2026 forecast (2026-05-21) baseline balance, % of GDP.
const EC_BALANCE_PCT: Record<number, number> = { 2026: -4.1, 2027: -4.3 };

/** The EC forecast edition the baseline above encodes ("<season> <year>",
 *  lowercase — the watcher's token format). Compared against the live EC
 *  Bulgaria page by scripts/budget/check_policy_anchors.ts; bump together
 *  with EC_BALANCE_PCT/MACRO_PATH when a new edition lands. */
export const EC_FORECAST_EDITION = "spring 2026";

// Interest-rate block (sources in the header note).
const LEGACY_RATE = 0.03;
const NEW_DEBT_RATE = 0.036;
const LEGACY_ROLLOVER = 0.12;

// Per-year macro assumptions. Nominal growth proxies the deflator with HICP
// for 2026-2027 (EC Spring 2026: real 2.5/2.2, HICP 4.2/2.6, unemployment
// 3.7/3.9); 2028-2030 extend the АСБП 2026-2028 medium-term frame (real
// ~2.4, inflation ~2.5).
interface MacroYear {
  year: number;
  nominalGrowthPct: number;
  realGrowthPct: number;
  hicpPct: number;
  unemploymentPct: number;
}
const MACRO_PATH: MacroYear[] = [
  {
    year: 2026,
    nominalGrowthPct: 6.8,
    realGrowthPct: 2.5,
    hicpPct: 4.2,
    unemploymentPct: 3.7,
  },
  {
    year: 2027,
    nominalGrowthPct: 4.9,
    realGrowthPct: 2.2,
    hicpPct: 2.6,
    unemploymentPct: 3.9,
  },
  {
    year: 2028,
    nominalGrowthPct: 5.0,
    realGrowthPct: 2.4,
    hicpPct: 2.5,
    unemploymentPct: 4.0,
  },
  {
    year: 2029,
    nominalGrowthPct: 5.0,
    realGrowthPct: 2.4,
    hicpPct: 2.5,
    unemploymentPct: 4.0,
  },
  {
    year: 2030,
    nominalGrowthPct: 5.0,
    realGrowthPct: 2.4,
    hicpPct: 2.5,
    unemploymentPct: 4.0,
  },
];

/** The projection's own 2026 nominal GDP — exported so levers priced
 *  against next-year GDP (the defense target) use the same figure the
 *  projection card displays, not a stale pipeline forecast. */
export const NOMINAL_GDP_2026_EUR =
  GDP_2025_EUR * (1 + MACRO_PATH[0].nominalGrowthPct / 100);

/** Projection years in order — the single source of truth for callers
 *  building per-year fixed paths (extend MACRO_PATH and these follow,
 *  keeping `fixedDeltaByYearEur` aligned element-for-element). */
export const PROJECTION_YEARS: number[] = MACRO_PATH.map((m) => m.year);

/** Nominal GDP per projection year — the same fold projectFiscalPath runs,
 *  exported so the behavioral layer (bgBehavioral.ts) can build per-year
 *  feedback paths against the projection's own GDP without touching the
 *  recursion. Kept byte-identical by a gate in __smoke_behavioral.ts. */
export const PROJECTION_GDP_EUR: number[] = MACRO_PATH.reduce<number[]>(
  (acc, m) => {
    const prev = acc.length ? acc[acc.length - 1] : GDP_2025_EUR;
    acc.push(prev * (1 + m.nominalGrowthPct / 100));
    return acc;
  },
  [],
);

interface PathState {
  debtEur: number;
  balanceEur: number;
  interestEur: number;
}

/** Project the general-government path with the simulator's year-1 policy
 *  delta (positive = the balance improves). Both paths run the same
 *  recursion; they differ only in the primary balance, so the interest gap
 *  between them is exactly the debt-service cost (or saving) the policy
 *  compounds into. `fixedDeltaByYearEur` carries lever paths with their own
 *  dynamics (pension indexation compounds ~7%/yr — flat-scaling its year-1
 *  delta would understate year 5 several-fold); entries are absolute EUR
 *  per projection year and are NOT rescaled by GDP. */
export const projectFiscalPath = (
  policyDeltaYear1Eur: number,
  fixedDeltaByYearEur?: number[],
): FiscalProjection => {
  const anchor = {
    gdpEur: GDP_2025_EUR,
    balanceEur: BALANCE_2025_EUR,
    balancePctGdp: (BALANCE_2025_EUR / GDP_2025_EUR) * 100,
    debtEur: DEBT_2025_EUR,
    debtPctGdp: (DEBT_2025_EUR / GDP_2025_EUR) * 100,
  };

  // The legacy bucket is shared: rollover happens on schedule regardless of
  // the policy path. Each path's debt above the legacy stock pays the
  // marginal rate.
  let legacyEur = DEBT_2025_EUR;
  let gdpEur = GDP_2025_EUR;
  // First-year GDP anchors the policy-delta scaling. Taken from the named
  // constant rather than discovered mid-loop, so the ratio stays finite
  // even if MACRO_PATH is ever re-anchored to a different first year.
  const gdpFirstYearEur = NOMINAL_GDP_2026_EUR;
  let primaryRatio2027 = 0;

  const base: PathState = {
    debtEur: DEBT_2025_EUR,
    balanceEur: 0,
    interestEur: 0,
  };
  const scen: PathState = {
    debtEur: DEBT_2025_EUR,
    balanceEur: 0,
    interestEur: 0,
  };

  const years: ProjectionYear[] = [];
  let extraInterestEur = 0;

  for (let i = 0; i < MACRO_PATH.length; i++) {
    const m = MACRO_PATH[i];
    gdpEur *= 1 + m.nominalGrowthPct / 100;

    // Interest on the start-of-year stock, per path.
    const interestOf = (s: PathState): number =>
      LEGACY_RATE * Math.min(legacyEur, s.debtEur) +
      NEW_DEBT_RATE * Math.max(0, s.debtEur - legacyEur);
    const baseInterest = interestOf(base);
    const scenInterest = interestOf(scen);

    // Baseline primary balance: backed out of the EC balance forecast for
    // 2026-2027, then held constant as a share of GDP (no policy change).
    const ecPct = EC_BALANCE_PCT[m.year];
    const basePrimaryEur =
      ecPct !== undefined
        ? (ecPct / 100) * gdpEur + baseInterest
        : (primaryRatio2027 / 100) * gdpEur;
    if (m.year === 2027) primaryRatio2027 = (basePrimaryEur / gdpEur) * 100;

    const policyDeltaEur =
      policyDeltaYear1Eur * (gdpEur / gdpFirstYearEur) +
      (fixedDeltaByYearEur?.[i] ?? 0);
    const scenPrimaryEur = basePrimaryEur + policyDeltaEur;

    base.interestEur = baseInterest;
    base.balanceEur = basePrimaryEur - baseInterest;
    base.debtEur -= base.balanceEur;
    scen.interestEur = scenInterest;
    scen.balanceEur = scenPrimaryEur - scenInterest;
    scen.debtEur -= scen.balanceEur;
    extraInterestEur += scenInterest - baseInterest;
    legacyEur *= 1 - LEGACY_ROLLOVER;

    years.push({
      year: m.year,
      gdpEur,
      policyDeltaEur,
      baselineBalanceEur: base.balanceEur,
      baselineBalancePctGdp: (base.balanceEur / gdpEur) * 100,
      baselineDebtEur: base.debtEur,
      baselineDebtPctGdp: (base.debtEur / gdpEur) * 100,
      baselineInterestEur: base.interestEur,
      balanceEur: scen.balanceEur,
      balancePctGdp: (scen.balanceEur / gdpEur) * 100,
      debtEur: scen.debtEur,
      debtPctGdp: (scen.debtEur / gdpEur) * 100,
      interestEur: scen.interestEur,
      realGrowthPct: m.realGrowthPct,
      hicpPct: m.hicpPct,
      unemploymentPct: m.unemploymentPct,
    });
  }

  return { anchorYear: 2025, anchor, years, extraInterestEur };
};
