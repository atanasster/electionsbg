// Loads the precomputed per-cycle council-vote × Census 2021 demographic
// cleavages aggregate written by scripts/parsers_local/build_local_demographics.ts.
// One ~1KB fetch per cycle. The local analogue of useDemographicCleavages —
// parties are keyed by canonical id (local elections have no partyNum), and
// the correlated signal is the proportional council vote.

import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { CensusMetric } from "@/data/census/censusTypes";
import { useLatestLocalCycle } from "./useLatestLocalCycle";

export type LocalDemographicCleavageParty = {
  canonicalId: string;
  displayName: string;
  color?: string;
  pctNational: number;
};

export type LocalDemographicCleavageRow = {
  metric: CensusMetric;
  rs: number[];
  spread: number;
};

export type LocalDemographicCleavagesPayload = {
  cycle: string;
  parties: LocalDemographicCleavageParty[];
  rows: LocalDemographicCleavageRow[];
};

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string]>): Promise<
  LocalDemographicCleavagesPayload | undefined
> => {
  const res = await fetch(
    dataUrl(`/${queryKey[1]}/dashboard/demographic_cleavages.json`),
  );
  if (!res.ok) return undefined;
  return (await res.json()) as LocalDemographicCleavagesPayload;
};

export const useLocalDemographicCleavages = (cycle?: string) => {
  const fallback = useLatestLocalCycle();
  const active = cycle ?? fallback;
  return useQuery({
    queryKey: ["local_demographic_cleavages", active],
    queryFn,
    enabled: !!active,
  });
};
