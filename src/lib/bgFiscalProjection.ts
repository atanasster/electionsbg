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
//  - 2025 outturn: the October 2026 EDP notification as submitted to Eurostat
//    and quoted by МФ in the Draft Budgetary Plan 2027 (ПБП-2027, 15.10.2026,
//    Табл. 4: deficit −4.0% of GDP / −€4.7 bn, debt 29.9% / €34.8 bn, nominal
//    GDP €116.0 bn). It revises the April notification (−3.5%) after the Сметна
//    палата audit of the 2025 accounts; Eurostat validates it ~22 October.
//  - 2026–2027 baseline balance and macro: ПБП-2027 (−5.0%, −4.3%; nominal
//    GDP +12.4% / +8.3%). This is the government's own plan under the
//    excessive-deficit procedure the Council opened on 2026-07-10 — newer than
//    the EC Spring 2026 forecast (−4.1%, −4.3%) it replaces here. When the EC
//    Autumn 2026 forecast lands, the ec_forecast_bg watcher flags it (see
//    EC_FORECAST_EDITION below) and a human decides which anchor to keep.
//  - 2028–2030: no-policy-change extension — the primary balance holds its
//    2027 share of GDP, the deficit then drifts with the endogenous
//    interest bill.
//  - Interest: two-bucket model. The debt inherited from 2025 pays the
//    implicit stock rate (~3.0% — Eurostat D41PAY interest ÷ debt) and rolls
//    over at ~22%/yr (≈ 1/4.4y, the Eurostat residual maturity of the BG debt
//    stock at end-2025 — the pace at which the legacy stock matures and re-prices
//    to the marginal rate; the ~8y figure in the Government Debt Management
//    Strategy 2026-2028 is the maturity AT ISSUANCE, not residual); rolled-over
//    and newly issued debt pays the marginal rate (~3.6% — the 2025 Eurobond
//    coupons 3.375-4.125% and the May-2026 10y reopening at 4.34% bracket it).
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
// October 2026 notification via ПБП-2027 Табл. 4. Both tables round: the
// deficit prints as −€4.7 bn AND −4.0% of GDP, the debt as €34.8 bn in the
// text AND 29.9% in the table — so each constant is chosen to reproduce the
// printed RATIO, which is what the chart shows.
const BALANCE_2025_EUR = -4_660_000_000;
const DEBT_2025_EUR = 34_740_000_000;

// Baseline general-government balance, % of GDP — ПБП-2027 Табл. 4 row 31
// (МФ, 15.10.2026). The EC Spring 2026 forecast it replaced: −4.1 / −4.3.
const EC_BALANCE_PCT: Record<number, number> = { 2026: -5.0, 2027: -4.3 };

/** The latest EC forecast edition that has been REVIEWED against this file
 *  ("<season> <year>", lowercase — the watcher's token format). Compared
 *  against the live EC Bulgaria page by scripts/budget/check_policy_anchors.ts.
 *  Since 2026-10-15 the values above come from the МФ Draft Budgetary Plan,
 *  which is newer than this edition; leave the token alone until a NEW EC
 *  edition lands, so the watcher still fires for Autumn 2026. */
export const EC_FORECAST_EDITION = "spring 2026";

// Interest-rate block (sources in the header note).
const LEGACY_RATE = 0.03;
const NEW_DEBT_RATE = 0.036;
const LEGACY_ROLLOVER = 0.22; // ≈ 1/4.4y Eurostat residual maturity of the stock

// Per-year macro assumptions. 2026-2027 are ПБП-2027 Табл. 3 (МФ autumn
// macro forecast, endorsed by the Fiscal Council): nominal GDP +12.4/+8.3
// (deflator 9.1/5.7), real 3.0/2.5, HICP 4.8/4.0, unemployment 3.4/3.4. The
// EC Spring 2026 figures they replaced were nominal 6.8/4.9, real 2.5/2.2 —
// the 2026 deflator revision alone lifts GDP by ~€6.5 bn, which is why debt
// RATIOS fall while the euro path barely moves. 2028-2030 extend the АСБП
// medium-term frame (real ~2.4, inflation ~2.5).
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
    nominalGrowthPct: 12.4,
    realGrowthPct: 3.0,
    hicpPct: 4.8,
    unemploymentPct: 3.4,
  },
  {
    year: 2027,
    nominalGrowthPct: 8.3,
    realGrowthPct: 2.5,
    hicpPct: 4.0,
    unemploymentPct: 3.4,
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
