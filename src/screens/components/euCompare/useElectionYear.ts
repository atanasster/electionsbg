// Translate the selected election (e.g. "2013_05_12") into a calendar year
// (2013). The EU compare dashboard uses this year to pick the corresponding
// data point from every multi-year series — WGI, COFOG composition, SILC,
// life expectancy — so the panels render as of the election cycle the user
// is looking at, not the latest available data.
//
// Pure election-driven. The /compare-specific panels that should re-anchor
// when the user picks a cabinet from the strip use `useCompareSnapshotYear`
// below — it returns the cabinet anchor year when set, else falls back to
// the election year. Keeps the cabinet anchor scoped to the panels that
// genuinely want it instead of leaking through useElectionYear into every
// other consumer (KpiTile, PeerSnapshotTable on /economy / /fiscal).

import { useMemo } from "react";
import { useElectionContext } from "@/data/ElectionContext";
import { useCabinetAnchorYear } from "@/data/macro/cabinetAnchorContext";

export const useElectionYear = (): number => {
  const { selected } = useElectionContext();
  return useMemo(() => {
    const m = /^(\d{4})/.exec(selected ?? "");
    return m ? Number(m[1]) : new Date().getFullYear();
  }, [selected]);
};

/** Compare-screen annual snapshot year — cabinet anchor year when set, else
 *  election year. Use in /compare's annual panels (WGI radar, COFOG
 *  multiples, inequality panel, spend-outcome scatters) so they re-anchor
 *  when the user picks a cabinet from the strip. */
export const useCompareSnapshotYear = (): number => {
  const anchorYear = useCabinetAnchorYear();
  const electionYear = useElectionYear();
  return anchorYear ?? electionYear;
};

// Pick the latest point in `series` with year ≤ `targetYear`. Falls back to
// the earliest available point if `targetYear` precedes the series (so the
// dashboard never renders an empty cell when the user picks a very old
// election that predates the data). Returns undefined for an empty series.
export const pickByYear = <T extends { year: number }>(
  series: readonly T[] | undefined,
  targetYear: number,
): T | undefined => {
  if (!series || series.length === 0) return undefined;
  // Series are emitted sorted ascending by year. Walk from the end.
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].year <= targetYear) return series[i];
  }
  // Target year precedes the series — fall back to the earliest point so
  // the panel still has something to render, with the year delta surfaced
  // to the consumer via the returned point's .year field.
  return series[0];
};
