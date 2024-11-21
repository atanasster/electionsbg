import { useCallback } from "react";
import { PartyInfo, PartyVotes, Votes } from "./dataTypes";

import { useQuery } from "@tanstack/react-query";

const queryFn = async (): Promise<PartyInfo[]> => {
  const response = await fetch("/2024_10/cik_parties.json");
  const data = await response.json();
  return data;
};

export const usePartyInfo = () => {
  const { data: parties } = useQuery({
    queryKey: ["parties"],
    queryFn,
  });

  const findParty = useCallback(
    (partyNum: number) => {
      return parties?.find((p) => p.number === partyNum);
    },
    [parties],
  );
  const topVotesParty = useCallback(
    (votes?: Votes[]): PartyVotes | undefined => {
      const tp = votes?.reduce((acc, curr) => {
        if (acc.totalVotes > curr.totalVotes) {
          return acc;
        }
        return curr;
      }, votes[0]);

      return tp ? ({ ...tp, ...findParty(tp.key) } as PartyVotes) : undefined;
    },
    [findParty],
  );
  return { findParty, topVotesParty };
};
