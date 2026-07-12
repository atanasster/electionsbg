// Per-sector headline stat for the government sector tiles, from the
// pre-generated static file (built by db:gen-sector-stats). Keyed by the SAME
// scope key the window hook derives (useProcurementWindow), so the sectors hub's
// scope control is live — one fetch, then look up the active scope.
//
// Each sector's value is either a euro figure (`kind:"eur"` — procurement € for
// the tender-driven sectors, payout € for pension/health/agri) or an outcome
// score (`kind:"score"` — the schools matura mean). The tile formats by kind.

import { useQuery } from "@tanstack/react-query";
import { formatEurCompact } from "@/lib/currency";
import { useProcurementWindow } from "./useProcurementWindow";

export interface SectorStat {
  kind: "eur" | "score";
  value: number;
}

/** Tile-ready string for a sector stat: a compact € for euro figures, or a
 *  two-decimal outcome score (matura). undefined for a missing/zero stat. */
export const formatSectorMetric = (
  stat: SectorStat | undefined,
  lang: string,
): string | undefined => {
  if (!stat || !stat.value) return undefined;
  if (stat.kind === "score")
    return stat.value.toLocaleString(lang, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  return formatEurCompact(stat.value, lang);
};

/** scopeKey → sectorId → stat */
export type SectorStatsFile = Record<string, Record<string, SectorStat>>;

/** The sector→stat map for the active ?pscope, or undefined while loading. */
export const useSectorStats = (): Record<string, SectorStat> | undefined => {
  const { all, year, selected } = useProcurementWindow();
  const key = all ? "all" : year != null ? `y:${year}` : `ns:${selected}`;
  const { data } = useQuery({
    queryKey: ["procurement", "sector-stats"] as const,
    queryFn: async (): Promise<SectorStatsFile> => {
      const r = await fetch("/procurement/derived/sector_stats.json");
      if (!r.ok) throw new Error(`sector-stats fetch failed: ${r.status}`);
      return r.json();
    },
    staleTime: Infinity,
  });
  return data?.[key];
};
