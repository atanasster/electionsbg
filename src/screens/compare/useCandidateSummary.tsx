import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { CandidateStats } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { CandidateRegionRow } from "./candidateSummary";

const regionsFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, string | null | undefined]
>): Promise<CandidateRegionRow[] | null> => {
  const [, election, name] = queryKey;
  if (!election || !name) return null;
  const response = await fetch(
    `/${election}/candidates/${encodeURIComponent(name)}/regions.json`,
  );
  if (!response.ok) return null;
  return response.json();
};

const prefStatsFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, string | null | undefined]
>): Promise<CandidateStats | null> => {
  const [, election, name] = queryKey;
  if (!election || !name) return null;
  const response = await fetch(
    `/${election}/candidates/${encodeURIComponent(name)}/preferences_stats.json`,
  );
  if (!response.ok) return null;
  return response.json();
};

export const useCandidateSummary = (name?: string | null) => {
  const { selected } = useElectionContext();

  const regions = useQuery({
    queryKey: ["candidate_regions", selected, name] as [
      string,
      string | null | undefined,
      string | null | undefined,
    ],
    queryFn: regionsFn,
    enabled: !!name,
    retry: false,
  });

  const prefStats = useQuery({
    queryKey: ["candidate_preferences_stats_compare", selected, name] as [
      string,
      string | null | undefined,
      string | null | undefined,
    ],
    queryFn: prefStatsFn,
    enabled: !!name,
    retry: false,
  });

  return {
    regionsRows: regions.data,
    prefStats: prefStats.data,
    isLoading: regions.isLoading || prefStats.isLoading,
  };
};
