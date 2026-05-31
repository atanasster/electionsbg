// Fetches the per-cycle national_municipalities.json — the full per-município
// directory (mayor + leading council party + runoff flag), concatenated across
// every oblast. The single fetch behind the standalone stat-tile pages on the
// country dashboard (all municipalities / runoffs / split control /
// independent mayors), so they don't fan out across all ~265 bundles.

import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { LocalNationalMunicipalities } from "./types";
import { useLatestLocalCycle } from "./useLatestLocalCycle";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string]>): Promise<
  LocalNationalMunicipalities | undefined
> => {
  const response = await fetch(
    dataUrl(`/${queryKey[1]}/national_municipalities.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `local national_municipalities fetch failed: ${response.status} ${response.url}`,
    );
  }
  return response.json();
};

export const useNationalMunicipalities = (cycle?: string, enabled = true) => {
  const fallback = useLatestLocalCycle();
  const active = cycle ?? fallback;
  return useQuery({
    queryKey: ["local_national_municipalities", active],
    queryFn,
    enabled,
  });
};
