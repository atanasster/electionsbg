// Per-oblast EU-funds (ИСУН) aggregate for the regional pack's choropleth + convergence
// scatter. Reads the static data/funds/projects/muni-map.json (per-municipality contracted
// /paid € + population + oblast) and folds it to the canonical oblast bucket via the shared
// src/lib/regionalOblast helpers (also used by the AI tool). Joins the latest GDP/capita
// from data/regional.json for the convergence axis. No DB — pure static join, so it renders
// without the procurement corpus loaded.
//
// ⚠ CAVEAT (surfaced in the tiles): muni-map is ALL ИСУН funds (every OP + the RRF), not
// only the two МРРБ regional OPs. The geo-attribution pins each project to its
// beneficiary, so Sofia city is inflated by nationally-run programmes headquartered there
// (the Kohesio caveat, §0b). The tiles label this and the convergence scatter drops Sofia
// from the fit. The two МРРБ regional OPs specifically are the RegionalCohesionTile.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { dataUrl } from "@/data/dataUrl";
import {
  aggregateRegionalOblasts,
  oblastToCanon,
  type MuniFundRow,
  type RegionalOblastAgg,
} from "@/lib/regionalOblast";

export type { RegionalOblastAgg } from "@/lib/regionalOblast";

interface MuniMapFile {
  munis?: MuniFundRow[];
}
interface RegionalFile {
  series?: {
    gdpPerCapita?: Record<string, { year: number; value: number }[]>;
  };
}

export const useRegionalOblast = (): {
  oblasts: RegionalOblastAgg[];
  isLoading: boolean;
} => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const muni = useQuery({
    queryKey: ["funds", "muni-map", "regional"] as const,
    queryFn: async (): Promise<MuniMapFile> => {
      const r = await fetch(dataUrl("/funds/projects/muni-map.json"));
      if (!r.ok) return {};
      return r.json();
    },
    staleTime: Infinity,
  });
  const region = useQuery({
    queryKey: ["regional", "gdpPerCapita"] as const,
    queryFn: async (): Promise<Record<string, number>> => {
      const r = await fetch(dataUrl("/regional.json"));
      if (!r.ok) return {};
      const d = (await r.json()) as RegionalFile;
      const g = d.series?.gdpPerCapita ?? {};
      const out: Record<string, number> = {};
      for (const [code, arr] of Object.entries(g)) {
        const canon = oblastToCanon(code);
        const last = arr[arr.length - 1];
        // PDV + PDV-00 and the Sofia shards collapse to one canon; keep the first
        // non-null (they carry identical oblast values).
        if (last && out[canon] == null) out[canon] = last.value;
      }
      return out;
    },
    staleTime: Infinity,
  });

  const oblasts = useMemo<RegionalOblastAgg[]>(() => {
    const munis = muni.data?.munis ?? [];
    if (!munis.length) return [];
    return aggregateRegionalOblasts(munis, region.data ?? {}, bg);
  }, [muni.data, region.data, bg]);

  return { oblasts, isLoading: muni.isLoading || region.isLoading };
};
