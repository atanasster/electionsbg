import { useQuery } from "@tanstack/react-query";
import { useElectionContext } from "../ElectionContext";
import { dataUrl } from "@/data/dataUrl";

export type VoteDemographicMunicipality = {
  obshtina: string;
  votes: { partyNum: number; totalVotes: number }[];
};

export type VoteDemographicsPayload = {
  election: string;
  municipalities: VoteDemographicMunicipality[];
};

// Per-municipality vote totals for the /demographics scatter, written by
// scripts/parties/build_demographics.ts. Joined client-side to the census
// municipalities payload to plot vote share against each demographic
// dimension across all ~265 municipalities.
export const useVoteDemographics = () => {
  const { selected } = useElectionContext();
  return useQuery({
    queryKey: ["vote_demographics", selected],
    queryFn: async (): Promise<VoteDemographicsPayload | undefined> => {
      if (!selected) return undefined;
      const res = await fetch(
        dataUrl(`/${selected}/dashboard/demographic_scatter.json`),
      );
      if (!res.ok) return undefined;
      return (await res.json()) as VoteDemographicsPayload;
    },
    enabled: !!selected,
  });
};
