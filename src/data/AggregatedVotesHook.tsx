import { useEffect, useState } from "react";
import {
  ElectionRegions,
  ElectionRegion,
  ElectionMunicipality,
  VoteResults,
} from "./dataTypes";
import { addVotes } from "./utils";

export const useAggregatedVotes = () => {
  const [votes, setVotes] = useState<ElectionRegions>([]);

  useEffect(() => {
    fetch("/2024_10/aggregated_votes.json")
      .then((response) => response.json())
      .then((data) => {
        setVotes(data);
      });
  }, []);
  const votesByRegion = (regionCode: string): ElectionRegion | undefined => {
    return votes.find((vote) => vote.key === regionCode);
  };
  const votesBySettlement = (
    regionCode: string,
    obshtina: string,
    ekatte: string,
  ) => {
    return votes
      .find((vote) => vote.key === regionCode)
      ?.municipalities.find((m) => m.obshtina === obshtina)
      ?.settlements.find((s) => s.ekatte === ekatte);
  };
  const votesByMunicipality = (
    regionCode: string,
    obshtina: string,
  ): ElectionMunicipality | undefined => {
    return votes
      .find((vote) => vote.key === regionCode)
      ?.municipalities.find((m) => m.obshtina === obshtina);
  };

  const countryVotes = (): VoteResults => {
    const acc: VoteResults = {
      actualTotal: 0,
      actualPaperVotes: 0,
      actualMachineVotes: 0,
      votes: [],
    };
    votes.map((r) => {
      addVotes(acc, r.results.votes, r.results.protocol);
    });

    return acc;
  };
  return {
    votesByRegion,
    regions: votes,
    votesBySettlement,
    votesByMunicipality,
    countryVotes,
  };
};
