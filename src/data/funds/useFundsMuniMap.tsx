// EU-funds (ИСУН) per-муни choropleth-map data — one denormalised row per
// muni for the /funds map tile. Sibling of useFundsProjectsIndex (the
// corpus-wide rollup); this hook serves the spatial dimension.

import { useQuery } from "@tanstack/react-query";
import { fetchFundPayload } from "./fetchFundPayload";
import type { FundsProjectsMuniMapFile } from "./types";

const fetchMap = (): Promise<FundsProjectsMuniMapFile | null> =>
  fetchFundPayload<FundsProjectsMuniMapFile>("muni-map");

export const useFundsMuniMap = () =>
  useQuery({
    queryKey: ["funds", "projects", "muni-map"] as const,
    queryFn: fetchMap,
    staleTime: Infinity,
  });
