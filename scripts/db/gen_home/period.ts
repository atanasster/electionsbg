// `YYYY-Qn` / `YYYY-MM` / `YYYY-MM-DD` → the ISO day the period ENDS on.
//
// ⚠️ ONE COPY, IN A MODULE THAT IMPORTS NOTHING. It lived in `hub_stats.ts` and was
// re-implemented in `events/adapters.ts` a few files away — two places to get the `Date.UTC`
// rollover right, which is the hazard the comment below records having already shipped once.
// Both generators feed a `computedAt`, so a plausible-but-wrong date from either is the same
// defect.

/**
 * A source period → the ISO DAY it ends on, so vintages in different dialects are
 * comparable. A quarter and a month both resolve to their LAST day, because a figure
 * covering 2026-Q2 is current as of the end of June, not the start of April — dating it
 * earlier would understate the artifact's freshness.
 */
export const periodToIsoDay = (period: string): string | null => {
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  if (q) {
    const endMonth = Number(q[2]) * 3;
    const day = new Date(Date.UTC(Number(q[1]), endMonth, 0));
    return day.toISOString().slice(0, 10);
  }
  // ⚠️ `0[1-9]|1[0-2]`, not `\d{2}`. `Date.UTC` ROLLS OVER, so a malformed "2026-13" became
  // "2027-01-31" and "2026-00" became "2025-12-31" — a plausible date fed straight into
  // `computedAt` and the election window. Returning null puts it through the filter instead.
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (m) {
    const day = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0));
    return day.toISOString().slice(0, 10);
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(period) ? period : null;
};

/**
 * Whole CALENDAR days between an artifact's `computedAt` and a source's `asOf`.
 *
 * ⚠️ BOTH SIDES TRUNCATED TO THE DAY, and that is the whole point. `computedAt` is deliberately
 * end-of-day (`T23:59:59.999Z`) while `asOf` is a bare day, so subtracting the instants gives
 * 0.99999999 days for a family whose vintage IS the newest day — which `Math.round` takes to 1.
 * Every reported lag was inflated by exactly one, every ceiling fired a calendar day early, and
 * the calibration figures written beside the ceilings were day-differences the code did not
 * produce.
 */
export const lagDays = (computedAt: string, asOf: string): number =>
  Math.round(
    (Date.parse(`${computedAt.slice(0, 10)}T00:00:00.000Z`) -
      Date.parse(`${asOf.slice(0, 10)}T00:00:00.000Z`)) /
      86_400_000,
  );
