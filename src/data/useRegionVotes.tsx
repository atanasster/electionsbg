import { useCallback } from "react";
import { ElectionRegions, ElectionRegion, VoteResults } from "./dataTypes";
import { addVotes } from "./utils";
import { useQuery } from "@tanstack/react-query";

const queryFn = async (): Promise<ElectionRegions> => {
  const response = await fetch("/2024_10/region_votes.json");
  const data = await response.json();
  return data;
};
export const useRegionVotes = () => {
  const { data: votes } = useQuery({
    queryKey: ["region_votes"],
    queryFn,
  });
  const votesByRegion = useCallback(
    (regionCode: string): ElectionRegion | undefined => {
      return votes?.find((vote) => vote.key === regionCode);
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
    countryVotes,
  };
};
