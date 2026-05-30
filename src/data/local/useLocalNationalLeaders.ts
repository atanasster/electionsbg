// Fetches the per-cycle national_leaders.json — precomputed cross-município
// leaderboards (top mayors by %, closest races, split control, independents)
// for the country dashboard, so the SPA renders them from one fetch instead
// of pulling all ~265 município bundles.

import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { LocalNationalLeaders } from "./types";
import { useLocalAsOf } from "./useLocalAsOf";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string]>): Promise<
  LocalNationalLeaders | undefined
> => {
  const response = await fetch(
    dataUrl(`/${queryKey[1]}/national_leaders.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `local national_leaders fetch failed: ${response.status} ${response.url}`,
    );
  }
  return response.json();
};

export const useLocalNationalLeaders = (cycle?: string) => {
  const { cycle: anchored } = useLocalAsOf();
  const active = cycle ?? anchored;
  return useQuery({
    queryKey: ["local_national_leaders", active],
    queryFn,
  });
};
