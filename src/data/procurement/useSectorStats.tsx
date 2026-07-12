// Per-sector headline stat (all-time total procurement €) for the government
// sector tiles, from the pre-generated static file (built by db:gen-sector-stats).
// One fetch, keyed by sector id (matches sectorRegistry / SECTOR_SCENES). Sectors
// with no procurement seat (pension, schools) are simply absent from the map.

import { useQuery } from "@tanstack/react-query";

export interface SectorStat {
  totalEur: number;
  contracts: number;
}

export type SectorStatsFile = Record<string, SectorStat>;

export const useSectorStats = (): SectorStatsFile | undefined => {
  const { data } = useQuery({
    queryKey: ["procurement", "sector-stats"] as const,
    queryFn: async (): Promise<SectorStatsFile> => {
      const r = await fetch("/procurement/derived/sector_stats.json");
      if (!r.ok) throw new Error(`sector-stats fetch failed: ${r.status}`);
      return r.json();
    },
    staleTime: Infinity,
  });
  return data;
};
