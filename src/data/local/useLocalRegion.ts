// Fetches the per-oblast region rollup (data/<cycle>/region/<oblast>.json) —
// the region dashboard's single fetch. Replaces the old client-side fan-out
// that loaded every município bundle in the oblast.

import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { LocalRegionRollup } from "./types";
import { useLocalAsOf } from "./useLocalAsOf";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string, string | undefined]>): Promise<
  LocalRegionRollup | undefined
> => {
  if (!queryKey[2]) return undefined;
  const response = await fetch(
    dataUrl(`/${queryKey[1]}/region/${queryKey[2]}.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `local region fetch failed: ${response.status} ${response.url}`,
    );
  }
  return response.json();
};

export const useLocalRegion = (oblast?: string, cycle?: string) => {
  const { cycle: anchored } = useLocalAsOf();
  const active = cycle ?? anchored;
  return useQuery({
    queryKey: ["local_region", active, oblast],
    queryFn,
    enabled: !!oblast,
  });
};
