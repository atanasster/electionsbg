// Two-shape data access for the officials-vs-CIK reconciliation.
//
//   useOfficialsDiff(cycle)
//     Fetches the full data/<cycle>/officials_diff.json (~60KB gzip with
//     287 municípios). Consumed by SverkaScreen for the national table.
//
//   useMunicipalityOfficialsDiff(obshtinaCode, cycle)
//     Fetches the per-município sidecar data/<cycle>/officials_diff/<code>.json
//     (~1KB). Consumed by the per-município OfficialsDiffTile so the dashboard
//     load doesn't pull the full national file.

import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { CycleOfficialsDiff, MunicipalityOfficialsDiff } from "./types";
import { useLatestLocalCycle } from "./useLatestLocalCycle";

const fullQueryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string]>): Promise<
  CycleOfficialsDiff | undefined
> => {
  const response = await fetch(dataUrl(`/${queryKey[1]}/officials_diff.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `officials_diff fetch failed: ${response.status} ${response.url}`,
    );
  }
  return response.json();
};

const sidecarQueryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string, string | null | undefined]>): Promise<
  MunicipalityOfficialsDiff | undefined
> => {
  if (!queryKey[2]) return undefined;
  const response = await fetch(
    dataUrl(`/${queryKey[1]}/officials_diff/${queryKey[2]}.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `officials_diff sidecar fetch failed: ${response.status} ${response.url}`,
    );
  }
  return response.json();
};

export const useOfficialsDiff = (cycle?: string) => {
  const fallback = useLatestLocalCycle();
  const active = cycle ?? fallback;
  return useQuery({
    queryKey: ["officials_diff", active],
    queryFn: fullQueryFn,
  });
};

/** Lookup a single município's diff via its per-município sidecar. */
export const useMunicipalityOfficialsDiff = (
  obshtinaCode?: string | null,
  cycle?: string,
): MunicipalityOfficialsDiff | undefined => {
  const fallback = useLatestLocalCycle();
  const active = cycle ?? fallback;
  const { data } = useQuery({
    queryKey: ["officials_diff_sidecar", active, obshtinaCode],
    queryFn: sidecarQueryFn,
    enabled: !!obshtinaCode,
  });
  return data;
};
