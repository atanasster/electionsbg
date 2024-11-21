import { useContext, useEffect, useState, createContext } from "react";
import {
  ElectionRegions,
  ElectionRegion,
  ElectionMunicipality,
  VoteResults,
  ElectionSettlement,
} from "./dataTypes";
import { addVotes } from "./utils";

type AggregatedContextType = {
  votesByRegion: (regionCode: string) => ElectionRegion | undefined;
  votesBySettlement: (
    regionCode: string,
    obshtina: string,
    ekatte: string,
  ) => ElectionSettlement | undefined;
  votesByMunicipality: (
    regionCode: string,
    obshtina: string,
  ) => ElectionMunicipality | undefined;
  countryVotes: () => VoteResults;
  regions: ElectionRegions;
};
const AggregatedContext = createContext<AggregatedContextType>({
  votesByRegion: () => undefined,
  votesBySettlement: () => undefined,
  votesByMunicipality: () => undefined,
  countryVotes: () => ({}) as VoteResults,
  regions: [],
});

export const AggregatedContextProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
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

  return (
    <AggregatedContext.Provider
      value={{
        votesByRegion,
        regions: votes,
        votesBySettlement,
        votesByMunicipality,
        countryVotes,
      }}
    >
      {children}
    </AggregatedContext.Provider>
  );
};

export const useAggregatedVotes = () => {
  const context = useContext(AggregatedContext);
  return context;
};
