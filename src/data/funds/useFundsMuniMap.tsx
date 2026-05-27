// EU-funds (ИСУН) per-муни choropleth-map data — one denormalised row per
// muni for the /funds map tile. Sibling of useFundsProjectsIndex (the
// corpus-wide rollup); this hook serves the spatial dimension.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { FundsProjectsMuniMapFile } from "./types";

const fetchMap = async (): Promise<FundsProjectsMuniMapFile | null> => {
  const r = await fetch(dataUrl("/funds/projects/muni-map.json"));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as FundsProjectsMuniMapFile;
};

export const useFundsMuniMap = () =>
  useQuery({
    queryKey: ["funds", "projects", "muni-map"] as const,
    queryFn: fetchMap,
    staleTime: Infinity,
  });
