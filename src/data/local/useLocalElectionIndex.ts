// Fetches the per-cycle index.json — município catalogue + national
// rollups (council R1 vote share, mayors won by canonical party).
//
// Used by the cycle dashboard (step 3 deliverable) and by the município
// tile's "X municípios in this cycle" hint.

import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { LocalElectionIndex } from "./types";
import { useLatestLocalCycle } from "./useLatestLocalCycle";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string]>): Promise<
  LocalElectionIndex | undefined
> => {
  const response = await fetch(dataUrl(`/${queryKey[1]}/index.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `local index fetch failed: ${response.status} ${response.url}`,
    );
  }
  return response.json();
};

export const useLocalElectionIndex = (cycle?: string) => {
  const fallback = useLatestLocalCycle();
  const active = cycle ?? fallback;
  return useQuery({
    queryKey: ["local_election_index", active],
    queryFn,
  });
};
