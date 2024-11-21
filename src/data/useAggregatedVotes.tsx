import { useCallback } from "react";
import {
  ElectionRegions,
  ElectionRegion,
  ElectionMunicipality,
  VoteResults,
} from "./dataTypes";
import { addVotes } from "./utils";
import { useQuery } from "@tanstack/react-query";

const queryFn = async (): Promise<ElectionRegions> => {
  const response = await fetch("/2024_10/aggregated_votes.json");
  const data = await response.json();
  return data;
};
export const useAggregatedVotes = () => {
  const { data: votes } = useQuery({
    queryKey: ["aggregated_votes"],
    queryFn,
  });
  const votesByRegion = useCallback(
    (regionCode: string): ElectionRegion | undefined => {
      return votes?.find((vote) => vote.key === regionCode);
    },
    [votes],
  );
  const votesBySettlement = useCallback(
    (regionCode: string, obshtina: string, ekatte: string) => {
      return votes
        ?.find((vote) => vote.key === regionCode)
        ?.municipalities.find((m) => m.obshtina === obshtina)
        ?.settlements.find((s) => s.ekatte === ekatte);
    },
    [votes],
  );
  const votesByMunicipality = useCallback(
    (
      regionCode: string,
      obshtina: string,
    ): ElectionMunicipality | undefined => {
      return votes
        ?.find((vote) => vote.key === regionCode)
        ?.municipalities.find((m) => m.obshtina === obshtina);
    },
    [votes],
  );

  const countryVotes = useCallback(() => {
    const acc: VoteResults = {
      actualTotal: 0,
      actualPaperVotes: 0,
      actualMachineVotes: 0,
      votes: [],
    };
    if (votes) {
      votes.map((r) => {
        addVotes(acc, r.results.votes, r.results.protocol);
      });
    }

    return acc;
  }, [votes]);

  return {
    votesByRegion,
    regions: votes,
    votesBySettlement,
    votesByMunicipality,
    countryVotes,
  };
};
