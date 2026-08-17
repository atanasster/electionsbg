// The one definition of "which years does this chart draw, and which of them carry a
// reading". Its own file because both person charts import it, and because exporting a
// helper from a component file breaks Fast Refresh (react-refresh/only-export-components).

import type { WealthPoint } from "./usePersonWealth";

/** A filing year, or a GAP year carrying nulls so the line breaks across it. The rest of
 *  WealthPoint is optional because a gap year has none of it — there is no filing to
 *  describe, which is the whole point. */
export type WealthRow = Partial<
  Omit<WealthPoint, "assetsEur" | "debtsEur" | "netEur">
> & {
  year: number;
  assetsEur: number | null;
  debtsEur: number | null;
  netEur: number | null;
  markerType?: "Entry" | "Vacate";
};

/**
 * One row per year across the series' whole span, with a year that has NO filing carrying
 * nulls rather than being omitted.
 *
 * Omitting it makes the data a list of the years that exist, and recharts then draws one
 * continuous curve straight through the years that do not: Демерджиев's page rose smoothly
 * from 2023 to 2026 across two years in which he declared nothing at all. A null breaks the
 * line instead (`connectNulls={false}` below) — the same rule the post cards already follow,
 * that an unpublished period must never read as a real reading.
 *
 * Null and not 0: a zero is a declared position, and would draw a collapse to the axis.
 */
export const padGapYears = (
  series: readonly WealthPoint[],
  markerByYear: ReadonlyMap<number, "Entry" | "Vacate"> = new Map(),
): WealthRow[] => {
  if (!series.length) return [];
  const byYear = new Map(series.map((p) => [p.year, p]));
  const rows: WealthRow[] = [];
  for (
    let year = series[0].year;
    year <= series[series.length - 1].year;
    year += 1
  ) {
    const point = byYear.get(year);
    rows.push(
      point
        ? { ...point, markerType: markerByYear.get(year) }
        : { year, assetsEur: null, debtsEur: null, netEur: null },
    );
  }
  return rows;
};
