import { useCallback, useMemo } from "react";
import { PartyInfo, PartyVotes, Votes } from "./dataTypes";

import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "./ElectionContext";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  PartyInfo[]
> => {
  if (!queryKey[1]) {
    return [];
  }
  const response = await fetch(`/${queryKey[1]}/cik_parties.json`);
  const data = await response.json();
  return data;
};
export const usePartyInfo = () => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["parties", selected],
    queryFn,
  });
  const parties: { [key: string]: PartyInfo } = useMemo(() => {
    return data ? data.reduce((acc, p) => ({ ...acc, [p.number]: p }), {}) : {};
  }, [data]);
  const findParty = useCallback(
    (partyNum: number) => {
      return parties[partyNum];
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

      return tp
        ? ({ ...tp, ...findParty(tp.partyNum) } as PartyVotes)
        : undefined;
    },
    [findParty],
  );
  return { findParty, topVotesParty };
};
