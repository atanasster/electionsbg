// Per-oblast EU-funds (ИСУН) aggregate for the regional pack's choropleth + convergence
// scatter. Folds the per-municipality ИСУН rollup (contracted/paid € + population + oblast)
// to the canonical oblast bucket via the shared src/lib/regionalOblast helpers (also used
// by the AI tool), and joins the latest GDP/capita from data/regional.json for the
// convergence axis.
//
// ⚠ SERVED FROM POSTGRES, NOT THE STATIC JSON. The ИСУН tree was migrated to Cloud SQL
// (fund_payloads), and `bucket:sync` now EXCLUDES `^funds/.*` — so the bucket's
// funds/projects/muni-map.json is unmaintained and goes stale (measured 2026-06-28 on the
// bucket vs 2026-07-13 locally) and is served uncompressed (67 KB vs ~10 KB gzipped).
// Reading it would render stale numbers in production. So this hook reuses the canonical
// `useFundsMuniMap()` (→ /api/db/fund-payload?kind=muni-map, ~12 KB). regional.json is
// still static — correctly: it is a small shared NUTS3 reference series (17 KB gzipped on
// the bucket) that many views cache.
//
// ⚠ CAVEAT (surfaced in the tiles): the muni map is ALL ИСУН funds (every OP + the RRF),
// not only the two МРРБ regional OPs — those are the RegionalCohesionTile.
//
// The geo-attribution pins each project to its DECLARED PLACE OF IMPLEMENTATION (ИСУН's
// „Местонахождение"), not to the beneficiary's seat, and national/regional/unresolved
// contracts are held out of the per-muni shards entirely (projects_ingest.ts →
// multi_location.json). Do not re-add the old "attributed to the beneficiary, so Sofia is
// inflated" caveat: measured 2026-07-17 against fund_payloads, Sofia city is 20.2% of the
// €29.0bn corpus on ~19% of the population and ranks 15/28 per resident (€4,593) — the
// poorest oblasts (Смолян €7,169, Кюстендил €7,116, Видин €7,027) top the per-capita table.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { dataUrl } from "@/data/dataUrl";
import { useFundsMuniMap } from "@/data/funds/useFundsMuniMap";
import {
  aggregateRegionalOblasts,
  oblastToCanon,
  type RegionalOblastAgg,
} from "@/lib/regionalOblast";

export type { RegionalOblastAgg } from "@/lib/regionalOblast";

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
  // PG-served (fund_payloads) — see the header note on why not the static JSON.
  const muni = useFundsMuniMap();
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
