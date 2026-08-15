// Ordering + bar geometry for the „Имущество по парламентарни групи" chart on /mp-assets.
// Pure, so the two decisions that are easy to get wrong are testable without a DOM:
//
//   1. THE PER-MP FIGURE IS THE MEDIAN, NOT THE MEAN. Declared wealth is dominated by single
//      filings — one MP at €10.07m is 46% of his group's €11.56m total in the 52nd — so a
//      mean describes that MP and calls it the group. Both figures ship (the mean rides
//      along as the complement, because the gap between them IS the skew), but the bar a
//      reader compares groups by is the median.
//   2. THE SCALE IS MAX-RELATIVE, unlike AttendanceByGroup's fixed 0-100%. Attendance is a
//      share, judged against „always"; euros have no such ceiling, so the widest bar is the
//      largest group and every other bar is read against it.
//
// A group with no valued filing has no median: it must render as "—" rather than as €0,
// which would claim its MPs declared nothing.

import type { MpAssetsPartyGroup } from "@/data/parliament/useAssetsRankings";

export type AssetsMetric = "total" | "median";

/** The figure the bar is drawn from, or null when the group cannot supply it. */
export const metricValue = (
  g: MpAssetsPartyGroup,
  metric: AssetsMetric,
): number | null => (metric === "total" ? g.totalNetEur : g.medianNetEur);

/** The OTHER figure, shown beside the bar so the total/median contrast stays visible in
 *  either mode. In median mode that is the mean — the skew signal. */
export const complementValue = (
  g: MpAssetsPartyGroup,
  metric: AssetsMetric,
): number | null => (metric === "total" ? g.medianNetEur : g.meanNetEur);

/** Groups ordered by the ACTIVE metric, largest first; a group with no figure sinks to the
 *  bottom rather than sorting as zero, and ties break on the party label so the order is
 *  stable across renders. */
export const orderByMetric = (
  groups: MpAssetsPartyGroup[],
  metric: AssetsMetric,
): MpAssetsPartyGroup[] =>
  [...groups].sort((a, b) => {
    const av = metricValue(a, metric);
    const bv = metricValue(b, metric);
    if (av == null && bv == null) return a.party.localeCompare(b.party);
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av || a.party.localeCompare(b.party);
  });

/** Largest value of the active metric — the bar scale's denominator. 0 when nothing is
 *  positive, which the width helper reads as "draw nothing". */
export const metricMax = (
  groups: MpAssetsPartyGroup[],
  metric: AssetsMetric,
): number =>
  groups.reduce((m, g) => {
    const v = metricValue(g, metric);
    return v != null && v > m ? v : m;
  }, 0);

/** Bar width in percent. A missing or non-positive figure draws NO bar: net worth can be
 *  negative (declared debts above declared assets), and a hairline for it would read as a
 *  small positive amount. */
export const barWidthPct = (value: number | null, max: number): number => {
  if (value == null || value <= 0 || max <= 0) return 0;
  return Math.max(1.5, Math.min(100, (value / max) * 100));
};
