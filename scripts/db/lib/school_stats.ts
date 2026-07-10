// Pure statistics for the schools serving loader — the OLS fit, the verdict
// banding, and the 7th→12th grade cohort pairing. Extracted from
// load_schools_pg.ts (which auto-runs main() on import, so its math can't be
// unit-tested there) into this side-effect-free module. See
// scripts/db/tests/school_stats.data.test.ts.

/** A school's cohort must reach this to be RANKED / carry a firm verdict. */
export const MIN_RANK_COHORT = 10;
/** Band width, in residual SDs, for над/близо/под очакваното. */
export const VERDICT_BAND_SD = 0.5;
/** ДЗИ year Y is the cohort that sat 7th-grade НВО in year Y − 5. */
export const NVO_LAG_YEARS = 5;

export type Verdict = "above" | "expected" | "under";

export interface Regression {
  slope: number;
  intercept: number;
  residualSd: number;
  n: number;
}

/** Ordinary least squares y ~ x. Returns null below 30 points (too few for a
 *  stable fit). residualSd falls back to 1 when the fit is perfect. */
export const ols = (pts: { x: number; y: number }[]): Regression | null => {
  if (pts.length < 30) return null;
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n;
  const my = pts.reduce((a, p) => a + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  const slope = sxx ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const resids = pts.map((p) => p.y - (intercept + slope * p.x));
  const residualSd = Math.sqrt(resids.reduce((a, e) => a + e * e, 0) / n) || 1;
  return { slope, intercept, residualSd, n };
};

/** Band a residual into над/близо/под at ±VERDICT_BAND_SD·residualSd. */
export const bandVerdict = (residual: number, residualSd: number): Verdict => {
  const cut = VERDICT_BAND_SD * residualSd;
  return residual > cut ? "above" : residual < -cut ? "under" : "expected";
};

/** 7th-grade НВО БЕЛ prior attainment for a ДЗИ cohort graduating in
 *  `latestYear` — its intake is NVO_LAG_YEARS earlier (ДЗИ 2026 ↔ НВО 2021).
 *  null when the year is unknown or that НВО year is absent. */
export const nvoPriorOf = (
  nvoByYear: Record<string, { bel?: number; math?: number }> | undefined,
  latestYear: number | null,
): number | null =>
  latestYear == null
    ? null
    : (nvoByYear?.[String(latestYear - NVO_LAG_YEARS)]?.bel ?? null);
