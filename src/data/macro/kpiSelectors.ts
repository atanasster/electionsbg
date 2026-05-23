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

// Pulls the value 1 year before the latest point. For quarterly series this
// is the same-quarter prior-year value (4 points back when consecutive, else
// found by year+quarter match). For annual series it's the prior year. Returns
// null if no prior-year point exists.
export const yoyChange = (
  series: MacroPoint[] | undefined,
): YoyChange | null => {
  if (!series || series.length < 2) return null;
  const latest = series[series.length - 1];
  // Try the indexed fast path first — works whenever the series has no gaps.
  const lookback = latest.quarter ? 4 : 1;
  const fast = series[series.length - 1 - lookback];
  if (
    fast &&
    fast.year === latest.year - 1 &&
    (latest.quarter ? fast.quarter === latest.quarter : true)
  ) {
    return {
      latest: latest.value,
      prior: fast.value,
      delta: latest.value - fast.value,
      comparedTo: periodLabel(fast),
    };
  }
  // Fallback: scan for the matching prior-year point. Handles series with
  // missing quarters or annual data joined to quarterly.
  const target = series.find(
    (p) =>
      p.year === latest.year - 1 &&
      (latest.quarter ? p.quarter === latest.quarter : true),
  );
  if (!target) return null;
  return {
    latest: latest.value,
    prior: target.value,
    delta: latest.value - target.value,
    comparedTo: periodLabel(target),
  };
};

// Trailing-N-year slice of a series. The bound is inclusive of `years` full
// calendar years before the latest point (so years=10 on a Q1 2026 series
// keeps everything from 2016 onward).
export const lastNYears = (
  series: MacroPoint[] | undefined,
  years: number,
): MacroPoint[] => {
  if (!series || series.length === 0) return [];
  const latest = series[series.length - 1];
  const cutoff = latest.year - years;
  return series.filter((p) => p.year >= cutoff);
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
// misleading than useful — caretaker cabinets that ran <3 months would
// otherwise have a 1-quarter "average" that swings wildly.
const MIN_POINTS_FOR_AVG = 4;

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
