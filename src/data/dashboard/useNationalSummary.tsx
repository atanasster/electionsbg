import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "../ElectionContext";
import { NationalSummary } from "./dashboardTypes";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  NationalSummary | undefined
> => {
  if (!queryKey[1]) return undefined;
  const response = await fetch(`/${queryKey[1]}/national_summary.json`);
  if (!response.ok) return undefined;
  return response.json();
};

export const nationalSummaryQueryKey = (
  election: string,
): [string, string | null | undefined] => ["national_summary", election];
export const nationalSummaryQueryFn = queryFn;

export const useNationalSummary = () => {
  const { selected } = useElectionContext();
  return useQuery({
    queryKey: nationalSummaryQueryKey(selected),
    queryFn,
  });
};

// Explicit-date variant for screens that need to fetch a summary for an
// election other than the one in ElectionContext (e.g. /compare).
export const useNationalSummaryFor = (election?: string) => {
  return useQuery({
    queryKey: nationalSummaryQueryKey(election ?? ""),
    queryFn,
    enabled: !!election,
  });
};
