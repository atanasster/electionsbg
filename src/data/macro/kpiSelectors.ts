// Pure selectors for the /indicators KPI dashboard. No hooks — consume from
// screens via useMemo so the result is recomputed only when macro/governments
// change, which is once per session given React Query's staleTime: Infinity.
//
// Kept framework-free so adding a new tile or metric doesn't require touching
// the scripts/ ingest pipeline — macro.json stays as raw upstream series and
// derived figures (YoY, cabinet averages) live next to the screens that need
// them.

import type { Government } from "@/data/governments/useGovernments";
import type {
  MacroIndicatorKey,
  MacroPayload,
  MacroPoint,
} from "@/data/macro/useMacro";
import { toFractionalYear } from "@/screens/components/governments/governmentTimelineUtils";

export type YoyChange = {
  latest: number;
  prior: number;
  /** latest - prior, in the same units as the underlying series. */
  delta: number;
  /** Period label of the prior point, e.g. "Q1 2025" or "2024". */
  comparedTo: string;
};

const periodLabel = (p: MacroPoint): string =>
  p.period ?? (p.quarter ? `${p.year} Q${p.quarter}` : `${p.year}`);

export type AsOf = { year: number; quarter: 1 | 2 | 3 | 4 };

// Latest MacroPoint with year/quarter ≤ asOf. Annual points (no .quarter)
// compare on year only. Returns null only if the series has no point at or
// before the cutoff. `asOf=null` falls back to the literal latest point so
// callers can use a single code path whether or not an election is selected.
export const pickAtOrBefore = (
  series: MacroPoint[] | undefined,
  asOf: AsOf | null,
): MacroPoint | null => {
  if (!series || series.length === 0) return null;
  if (!asOf) return series[series.length - 1];
  for (let i = series.length - 1; i >= 0; i--) {
    const p = series[i];
    if (p.year < asOf.year) return p;
    if (p.year === asOf.year) {
      if (!p.quarter) return p; // annual: same year is always ≤
      if (p.quarter <= asOf.quarter) return p;
    }
  }
  return null;
};

// Same-period prior-year value relative to an arbitrary anchor point — used
// by KpiTile to compute YoY against the as-of value rather than the series
// tail. Returns null if no prior-year same-quarter point exists.
export const yoyChangeFor = (
  series: MacroPoint[] | undefined,
  point: MacroPoint | null,
): YoyChange | null => {
  if (!series || !point) return null;
  const target = series.find(
    (p) =>
      p.year === point.year - 1 &&
      (point.quarter ? p.quarter === point.quarter : !p.quarter),
  );
  if (!target) return null;
  return {
    latest: point.value,
    prior: target.value,
    delta: point.value - target.value,
    comparedTo: periodLabel(target),
  };
};

// Sliding trailing-N-year window ending at `endPoint`. The right edge moves
// with the as-of anchor so the sparkline visually ends at the value shown in
// the KPI tile.
export const lastNYearsEnding = (
  series: MacroPoint[] | undefined,
  years: number,
  endPoint: MacroPoint | null,
): MacroPoint[] => {
  if (!series || series.length === 0 || !endPoint) return [];
  const cutoff = endPoint.year - years;
  return series.filter((p) => {
    if (p.year < cutoff || p.year > endPoint.year) return false;
    if (p.year === endPoint.year && endPoint.quarter && p.quarter) {
      return p.quarter <= endPoint.quarter;
    }
    return true;
  });
};

export type CabinetMetrics = {
  govId: string;
  /** Mean quarterly real GDP growth during the cabinet's tenure window. */
  avgGdpGrowth: number | null;
  /** Mean quarterly HICP inflation during tenure. */
  avgInflation: number | null;
  /** Mean quarterly unemployment rate during tenure. */
  avgUnemployment: number | null;
  /** Change in gross general government debt (% GDP), end-of-tenure minus
   *  start-of-tenure. Signed: green tint when negative, red when positive. */
  debtChangePpGdp: number | null;
  /** Mean quarterly budget balance (% GDP). Negative = deficit. */
  avgBudgetBalancePpGdp: number | null;
  /** Net EU funds received minus contribution during tenure, in EUR billions.
   *  Annual series prorated by month-fraction in the start and end years. */
  netEuFundsEurBn: number | null;
};

// Fractional position of a point on the year axis. Mid-quarter for quarterly,
// mid-year for annual. Mirrors pointToFractionalX from useMacro.ts but inlined
// to avoid a dependency cycle.
const fractionalX = (p: MacroPoint): number =>
  p.quarter ? p.year + (p.quarter - 1) * 0.25 + 0.125 : p.year + 0.5;

const within = (
  macro: MacroPayload,
  key: MacroIndicatorKey,
  startFrac: number,
  endFrac: number,
): MacroPoint[] =>
  (macro.series[key] ?? []).filter((p) => {
    const x = fractionalX(p);
    return x >= startFrac && x <= endFrac;
  });

const mean = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
};

// Below this many data points within the cabinet window, the average is more
// misleading than useful — a single-quarter "average" swings wildly and
// invites overinterpretation. Two quarters is the minimum we'll smooth, which
// covers most 6+ month caretakers; sub-quarter cabinets stay "—".
const MIN_POINTS_FOR_AVG = 2;

// Net EU funds during the tenure, in EUR billions. macro.json `euFunds` and
// `euContribution` are annual EUR-billion series; we prorate the first and
// last calendar years by month-fraction so a half-year cabinet doesn't get
// credited with a full year of receipts.
const computeNetEuFunds = (
  g: Government,
  macro: MacroPayload,
): number | null => {
  const funds = macro.series.euFunds ?? [];
  const contrib = macro.series.euContribution ?? [];
  if (funds.length === 0 || contrib.length === 0) return null;
  const start = new Date(g.startDate);
  const endIso = g.endDate ?? new Date().toISOString();
  const end = new Date(endIso);
  const startY = start.getUTCFullYear();
  const startM = start.getUTCMonth(); // 0-based
  const endY = end.getUTCFullYear();
  const endM = end.getUTCMonth();
  let total = 0;
  let anyOverlap = false;
  for (const fp of funds) {
    if (fp.year < startY || fp.year > endY) continue;
    const cp = contrib.find((c) => c.year === fp.year);
    if (!cp) continue;
    const net = fp.value - cp.value;
    let fraction = 1;
    if (fp.year === startY && fp.year === endY) {
      fraction = (endM - startM + 1) / 12;
    } else if (fp.year === startY) {
      fraction = (12 - startM) / 12;
    } else if (fp.year === endY) {
      fraction = (endM + 1) / 12;
    }
    total += net * fraction;
    anyOverlap = true;
  }
  return anyOverlap ? Math.round(total * 100) / 100 : null;
};

export const cabinetMetricsFor = (
  g: Government,
  macro: MacroPayload,
): CabinetMetrics => {
  const startFrac = toFractionalYear(g.startDate);
  const endFrac = toFractionalYear(g.endDate ?? new Date().toISOString());

  const gdp = within(macro, "gdpGrowth", startFrac, endFrac).map(
    (p) => p.value,
  );
  const infl = within(macro, "inflation", startFrac, endFrac).map(
    (p) => p.value,
  );
  const unemp = within(macro, "unemployment", startFrac, endFrac).map(
    (p) => p.value,
  );
  const bal = within(macro, "budgetBalance", startFrac, endFrac).map(
    (p) => p.value,
  );
  const debt = within(macro, "govDebt", startFrac, endFrac);

  return {
    govId: g.id,
    avgGdpGrowth: gdp.length >= MIN_POINTS_FOR_AVG ? mean(gdp) : null,
    avgInflation: infl.length >= MIN_POINTS_FOR_AVG ? mean(infl) : null,
    avgUnemployment: unemp.length >= MIN_POINTS_FOR_AVG ? mean(unemp) : null,
    avgBudgetBalancePpGdp: bal.length >= MIN_POINTS_FOR_AVG ? mean(bal) : null,
    debtChangePpGdp:
      debt.length >= 2 ? debt[debt.length - 1].value - debt[0].value : null,
    netEuFundsEurBn: computeNetEuFunds(g, macro),
  };
};

export const cabinetMetricsForAll = (
  governments: Government[],
  macro: MacroPayload,
): CabinetMetrics[] => governments.map((g) => cabinetMetricsFor(g, macro));
