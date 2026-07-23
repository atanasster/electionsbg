// Pure geometry behind MaturaTrendChart — kept out of the component so it can
// be unit-tested and so the chart module stays a clean fast-refresh boundary.
//
// The chart is a two-band composition (the price/volume idiom): the score line
// lives in the upper band, the cohort-size bars in a dedicated strip along the
// bottom. Sharing one full-height scale doesn't work here — the score domain is
// padded tight so the half-grade spread reads, which puts the weakest year's
// point at ~27% height, right where a bar drawn from the baseline would be.

import { dziBelExamDate } from "@/data/schools/maturaCalendar";
import { toFractionalYear } from "@/screens/components/governments/governmentTimelineUtils";

export interface MaturaYear {
  year: number;
  avg: number | null;
  examinees: number;
}

export interface MaturaRow {
  /** Fractional year of the exam date — the x scale. */
  t: number;
  /** ISO exam date. */
  date: string;
  year: number;
  avg: number;
  examinees: number;
}

/** Padding on each side of the x domain, in years, so the first and last dot
 *  aren't clipped in half by the plot edge (~5 weeks). */
export const X_PAD = 0.1;

/** Plottable rows in exam-date order; years without a score are dropped. */
export const buildMaturaRows = (national: MaturaYear[]): MaturaRow[] =>
  national
    .filter((n): n is MaturaYear & { avg: number } => n.avg != null)
    .map((n) => {
      const date = dziBelExamDate(n.year);
      return {
        t: toFractionalYear(date),
        date,
        year: n.year,
        avg: n.avg,
        examinees: n.examinees,
      };
    })
    .sort((a, b) => a.t - b.t);

/** Score axis bounds. The band is narrow (~0.5 of a grade across five years),
 *  so pad it to a tenth on each side or the line flattens into a smear. */
export const scoreDomain = (rows: MaturaRow[]): [number, number] => {
  const scores = rows.map((r) => r.avg);
  const lo = Math.min(...scores);
  const hi = Math.max(...scores);
  const pad = Math.max(0.15, (hi - lo) * 0.25);
  return [Math.floor((lo - pad) * 10) / 10, Math.ceil((hi + pad) * 10) / 10];
};

/** Gridline values across a score domain — halves when the span is wide enough
 *  to carry them, quarters when it isn't (the usual case). */
export const scoreTicks = ([lo, hi]: [number, number]): number[] => {
  const step = hi - lo > 1 ? 0.5 : 0.25;
  const ticks: number[] = [];
  // Work in tenths to keep the accumulation off binary fractions.
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return ticks;
};

/** Top of the cohort band. The bars own their own strip, so they need only a
 *  little headroom above the tallest year. */
export const cohortMax = (rows: MaturaRow[]): number =>
  Math.max(...rows.map((r) => r.examinees)) * 1.15;

/** Inverse of toFractionalYear — turns the padded x-domain edges back into ISO
 *  dates so the cabinet strip spans exactly the plotted window. Padding the
 *  domain but not the strip would shift every band by ~5 weeks of width. */
export const fromFractionalYear = (t: number): string => {
  const y = Math.floor(t);
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  // Round to the millisecond: the fraction round-trips a hair short, which
  // `new Date` then truncates to 23:59:59.999 of the day before.
  const ms = Math.round(start + (t - y) * (end - start));
  return new Date(ms).toISOString().slice(0, 10);
};
