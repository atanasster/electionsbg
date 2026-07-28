// The by-settlement page's maps + header, precomputed per pscope (migration 119).
//
// Everything that page shows EXCEPT the ranking table: the four KPI tiles, the "national
// procurement" card, and the ≤32-row per-oblast aggregate the three choropleths colour. The
// ranking itself is a server-paginated DbDataTable resource, so the two are fetched
// separately — the maps no longer wait on ~868 settlement rows they never needed.
//
// This replaces the whole-corpus blob the page used to download and re-aggregate in the
// browser. Keyed by scopeKey rather than by (from, to) because the payload is looked up by
// primary key, not recomputed per window.

import { useQuery } from "@tanstack/react-query";
import { useScopeWindow } from "@/data/scope/useScopeWindow";

/** One oblast's totals. Keyed by the province NAME as the procurement corpus spells it —
 *  the client folds that to a canonical oblast code (provinceToCanon), because the fold
 *  carries the Sofia/Plovdiv special cases and the population join the map needs. */
export type ProcurementOblastRow = {
  province: string;
  totalEur: number;
  contractCount: number;
  awarderCount: number;
};

export type ProcurementGeoPayload = {
  summary: {
    totalContracts: number;
    totalEur: number;
    settlementCount: number;
    national: {
      contractCount: number;
      awardCount: number;
      totalEur: number;
      totalOther: Record<string, number>;
      awarderCount: number;
    };
  };
  oblasti: ProcurementOblastRow[];
};

export const useProcurementGeo = () => {
  const { scopeKey } = useScopeWindow();
  return useQuery({
    queryKey: ["procurement", "geo", scopeKey] as const,
    queryFn: async (): Promise<ProcurementGeoPayload | null> => {
      const r = await fetch(
        `/api/db/procurement-geo?scope=${encodeURIComponent(scopeKey)}`,
      );
      // 404 = the scope has no precomputed payload (the loader has not run for it on this
      // database). Null renders the empty state rather than throwing a page-level error,
      // since every other scope on the same page still works.
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      return (await r.json()) as ProcurementGeoPayload | null;
    },
    staleTime: Infinity,
  });
};
