// Fetches the per-município local-election bundle for a given obshtina code.
//
// Mirrors useMunicipalityVotes — same React-Query convention, same dataUrl
// seam — but reads from the local cycle folder (data/<cycle>/municipalities/<code>.json)
// rather than the parliamentary one. The cycle defaults to whatever
// useLatestLocalCycle returns; pass a specific cycle to look at a previous
// one (used by the cycle dashboard).

import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { LocalMunicipalityBundle } from "./types";
import { useLatestLocalCycle } from "./useLatestLocalCycle";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string, string | null | undefined]>): Promise<
  LocalMunicipalityBundle | undefined
> => {
  if (!queryKey[2]) return undefined;
  const response = await fetch(
    dataUrl(`/${queryKey[1]}/municipalities/${queryKey[2]}.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `local municipality fetch failed: ${response.status} ${response.url}`,
    );
  }
  return response.json();
};

export const useLocalMunicipality = (
  obshtinaCode?: string | null,
  cycle?: string,
) => {
  const fallback = useLatestLocalCycle();
  const active = cycle ?? fallback;
  const { data, isLoading, error } = useQuery({
    queryKey: ["local_municipality", active, obshtinaCode],
    queryFn,
    enabled: !!obshtinaCode,
  });
  return { municipality: data, isLoading, error, cycle: active };
};
