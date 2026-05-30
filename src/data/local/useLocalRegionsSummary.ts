// Fetches the per-cycle regions_summary.json — one lightweight row per oblast
// (top mayor party + counts) that drives the national mayors-control
// choropleth and the top-regions table. Single fetch for the whole national
// dashboard's regional layer.

import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { LocalRegionsSummary } from "./types";
import { useLocalAsOf } from "./useLocalAsOf";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string]>): Promise<
  LocalRegionsSummary | undefined
> => {
  const response = await fetch(dataUrl(`/${queryKey[1]}/regions_summary.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `local regions_summary fetch failed: ${response.status} ${response.url}`,
    );
  }
  return response.json();
};

export const useLocalRegionsSummary = (cycle?: string) => {
  const { cycle: anchored } = useLocalAsOf();
  const active = cycle ?? anchored;
  return useQuery({
    queryKey: ["local_regions_summary", active],
    queryFn,
  });
};
