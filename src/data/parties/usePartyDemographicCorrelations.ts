import { useQuery } from "@tanstack/react-query";
import { useElectionContext } from "../ElectionContext";
import type { CensusMetric } from "../census/censusTypes";
import { dataUrl } from "@/data/dataUrl";

export type PartyDemographicCorrelation = {
  metric: CensusMetric;
  r: number;
  n: number;
};

export type PartyDemographicsPayload = {
  election: string;
  partyNum: number;
  correlations: PartyDemographicCorrelation[];
};

// Loads the precomputed correlations file written by
// scripts/parties/build_demographics.ts. Tiny payload (~14 entries) so the
// party dashboard tile can render without fetching the full census + running
// 14 client-side Pearson passes.
export const usePartyDemographicCorrelations = (partyNum?: number) => {
  const { selected } = useElectionContext();
  return useQuery({
    queryKey: ["party_demographics", selected, partyNum],
    queryFn: async (): Promise<PartyDemographicsPayload | undefined> => {
      if (!selected || partyNum === undefined) return undefined;
      const res = await fetch(
        dataUrl(`/${selected}/parties/demographics/${partyNum}.json`),
      );
      if (!res.ok) return undefined;
      return (await res.json()) as PartyDemographicsPayload;
    },
    enabled: !!selected && partyNum !== undefined,
  });
};
