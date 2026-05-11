import { useQuery } from "@tanstack/react-query";
import { useElectionContext } from "../ElectionContext";
import type { CensusMetric } from "../census/censusTypes";
import { dataUrl } from "@/data/dataUrl";

export type DemographicCleavageParty = {
  partyNum: number;
  nickName: string;
  nickName_en?: string;
  color?: string;
  pctNational: number;
};

export type DemographicCleavageRow = {
  metric: CensusMetric;
  rs: number[];
  spread: number;
};

export type DemographicCleavagesPayload = {
  election: string;
  parties: DemographicCleavageParty[];
  rows: DemographicCleavageRow[];
};

// Loads the precomputed home-dashboard cleavages aggregate written by
// scripts/parties/build_demographics.ts. One ~1KB fetch per election.
export const useDemographicCleavages = () => {
  const { selected } = useElectionContext();
  return useQuery({
    queryKey: ["demographic_cleavages", selected],
    queryFn: async (): Promise<DemographicCleavagesPayload | undefined> => {
      if (!selected) return undefined;
      const res = await fetch(
        dataUrl(`/${selected}/dashboard/demographic_cleavages.json`),
      );
      if (!res.ok) return undefined;
      return (await res.json()) as DemographicCleavagesPayload;
    },
    enabled: !!selected,
  });
};
