// Per-analysis headline stat for the /analysis hub tiles, from a pre-generated
// per-election file (built by the reports pipeline — scripts/reports/
// analysis_stats.ts). One fetch keyed by the selected election, then look up the
// active analysis id. Mirrors src/data/procurement/useSectorStats.tsx, but the
// key is the election (the sectors hub keys by ?pscope; the analyses are all
// scoped to a single election).
//
// The headline MEANING varies per analysis — `kind` drives number formatting and
// `captionKey` names what the figure measures, so the mixed metric kinds stay
// honest side by side (as with the sector tiles). A metric is simply absent when
// its source file wasn't available at generation time; the tile then renders
// without a number, exactly like a sector with no stat.

import type { TFunction } from "i18next";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "@/data/ElectionContext";
import { dataUrl } from "@/data/dataUrl";
import { formatEurCompact } from "@/lib/currency";

export interface AnalysisStat {
  /** count = grouped integer; percent = value + %; eur = compact €; score =
   *  two-decimal outcome (poll MAE in pp). */
  kind: "count" | "percent" | "eur" | "score";
  value: number;
  /** Denominator for a "N of M" count (e.g. critical sections of all). */
  total?: number;
  /** i18n key for the one-word caption; may interpolate {{total}}. */
  captionKey: string;
}

/** analysisId → stat, for one election. */
export type AnalysisStatsFile = Record<string, AnalysisStat>;

/** Tile-ready string for an analysis stat: compact € for money, a two-decimal
 *  score, a one-decimal percent, or a thousands-grouped integer. undefined for a
 *  missing/zero-less stat (the tile then hides the number). */
export const formatAnalysisMetric = (
  stat: AnalysisStat | undefined,
  lang: string,
): string | undefined => {
  if (!stat || stat.value == null) return undefined;
  switch (stat.kind) {
    case "eur":
      return stat.value ? formatEurCompact(stat.value, lang) : undefined;
    case "score":
      return stat.value.toLocaleString(lang, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    case "percent":
      // Pin one decimal so the percent tiles read uniformly side by side
      // (matching the two-decimal `score` branch's fixed precision).
      return `${stat.value.toLocaleString(lang, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })}%`;
    case "count":
    default:
      return Math.round(stat.value).toLocaleString(lang);
  }
};

/** One-word caption under the tile number, telling the reader what the figure
 *  measures. Interpolates {{total}} (grouped) for count-of-total stats. */
export const analysisMetricCaption = (
  stat: AnalysisStat | undefined,
  t: TFunction,
  lang: string,
): string | undefined => {
  if (!stat || stat.value == null) return undefined;
  return t(stat.captionKey, {
    total:
      stat.total != null ? Math.round(stat.total).toLocaleString(lang) : "",
  });
};

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  AnalysisStatsFile | undefined
> => {
  if (!queryKey[1]) return undefined;
  const response = await fetch(dataUrl(`/${queryKey[1]}/analysis_stats.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`analysis_stats fetch failed: ${response.status}`);
  }
  return response.json();
};

/** The analysisId→stat map for the selected election, or undefined while
 *  loading / when the file is absent. */
export const useAnalysisStats = (): AnalysisStatsFile | undefined => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["analysis_stats", selected] as const,
    queryFn,
    staleTime: Infinity,
  });
  return data;
};
