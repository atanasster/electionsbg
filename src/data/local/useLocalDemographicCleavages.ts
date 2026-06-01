// Loads the precomputed per-cycle vote × Census 2021 demographic cleavages
// aggregate written by scripts/parsers_local/build_local_demographics.ts.
// One ~1KB fetch per cycle. The local analogue of useDemographicCleavages —
// parties are keyed by canonical id (local elections have no partyNum). Two
// signals are available per cycle: the proportional council vote (default) and
// the first-round mayoral vote (`race: "mayor"`).

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

export type LocalCleavageRace = "council" | "mayor";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string, LocalCleavageRace]>): Promise<
  LocalDemographicCleavagesPayload | undefined
> => {
  const file =
    queryKey[2] === "mayor"
      ? "demographic_cleavages_mayor.json"
      : "demographic_cleavages.json";
  const res = await fetch(dataUrl(`/${queryKey[1]}/dashboard/${file}`));
  if (!res.ok) return undefined;
  return (await res.json()) as LocalDemographicCleavagesPayload;
};

export const useLocalDemographicCleavages = (
  cycle?: string,
  race: LocalCleavageRace = "council",
) => {
  const fallback = useLatestLocalCycle();
  const active = cycle ?? fallback;
  return useQuery({
    queryKey: ["local_demographic_cleavages", active ?? "", race],
    queryFn,
    enabled: !!active,
  });
};
