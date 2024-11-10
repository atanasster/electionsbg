import { useEffect, useState } from "react";
import {
  ElectionRegions,
  ElectionRegion,
  ElectionMunicipality,
} from "./dataTypes";

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
    return votes.find((vote) => vote.nuts3 === regionCode);
  };
  const votesBySettlement = (
    regionCode: string,
    obshtina: string,
    ekatte: string,
  ) => {
    return votes
      .find((vote) => vote.nuts3 === regionCode)
      ?.municipalities.find((m) => m.obshtina === obshtina)
      ?.settlements.find((s) => s.ekatte === ekatte);
  };
  const votesByMunicipality = (
    regionCode: string,
    obshtina: string,
  ): ElectionMunicipality | undefined => {
    return votes
      .find((vote) => vote.nuts3 === regionCode)
      ?.municipalities.find((m) => m.obshtina === obshtina);
  };

  return {
    votesByRegion,
    regions: votes,
    votesBySettlement,
    votesByMunicipality,
  };
};
