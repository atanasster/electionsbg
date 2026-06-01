// Fetches the per-cycle national_leaders_full.json — the uncapped companion to
// national_leaders.json, carrying every contested município's strongest mandate
// (topMayorsByPct) and closest race (closestRaces). Loaded only on the
// standalone "see details" leaderboard pages, so the full ranked lists never
// bloat the country dashboard's national_leaders.json fetch.

import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { LocalNationalLeadersFull } from "./types";
import { useLocalAsOf } from "./useLocalAsOf";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string]>): Promise<
  LocalNationalLeadersFull | undefined
> => {
  const response = await fetch(
    dataUrl(`/${queryKey[1]}/national_leaders_full.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `local national_leaders_full fetch failed: ${response.status} ${response.url}`,
    );
  }
  return response.json();
};

export const useLocalLeadersFull = (cycle?: string, enabled = true) => {
  const { cycle: anchored } = useLocalAsOf();
  const active = cycle ?? anchored;
  return useQuery({
    queryKey: ["local_national_leaders_full", active],
    queryFn,
    enabled,
  });
};
