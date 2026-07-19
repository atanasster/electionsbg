import { useMemo } from "react";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "../ElectionContext";
import { usePartyInfo } from "../parties/usePartyInfo";
import { useRegions } from "../regions/useRegions";
import { CandidateStats, PreferencesInfo } from "../dataTypes";
import { CandidateDashboardSummary } from "./candidateDashboardTypes";
import { computeCandidateSummary } from "./computeCandidateSummary";
import { dataUrl } from "@/data/dataUrl";

const isJsonResponse = (response: Response) =>
  (response.headers.get("content-type") ?? "").includes("json");

const statsQueryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, string | undefined]
>): Promise<CandidateStats | null> => {
  if (!queryKey[1] || !queryKey[2]) return null;
  const response = await fetch(
    dataUrl(`/${queryKey[1]}/candidates/${queryKey[2]}/preferences_stats.json`),
  );
  if (response.status === 404 || !isJsonResponse(response)) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

const regionsQueryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, string | undefined]
>): Promise<PreferencesInfo[] | null> => {
  if (!queryKey[1] || !queryKey[2]) return null;
  const response = await fetch(
    dataUrl(`/${queryKey[1]}/candidates/${queryKey[2]}/regions.json`),
  );
  if (response.status === 404 || !isJsonResponse(response)) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useCandidateSummary = (
  name?: string,
): {
  data: CandidateDashboardSummary | null | undefined;
  isLoading: boolean;
} => {
  const { selected, priorElections } = useElectionContext();
  const { findParty } = usePartyInfo();
  const { findRegion } = useRegions();

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["candidate_preferences_stats", selected, name],
    queryFn: statsQueryFn,
  });

  const { data: regionRows, isLoading: regionsLoading } = useQuery({
    queryKey: ["candidate_regions", selected, name],
    queryFn: regionsQueryFn,
  });

  const data = useMemo<CandidateDashboardSummary | null | undefined>(() => {
    if (!name || !selected) return undefined;
    if (regionRows === undefined) return undefined;
    if (regionRows === null) return null;
    return computeCandidateSummary({
      name,
      selected,
      priorElectionName: priorElections?.name,
      regionRows,
      stats: stats ?? null,
      findParty,
      findRegion,
    });
  }, [
    name,
    selected,
    regionRows,
    stats,
    findParty,
    findRegion,
    priorElections,
  ]);

  return {
    data,
    isLoading: statsLoading || regionsLoading,
  };
};
