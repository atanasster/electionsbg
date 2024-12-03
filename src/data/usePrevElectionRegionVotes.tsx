import { useCallback } from "react";
import { ElectionRegions, VoteResults, PartyInfo, Votes } from "./dataTypes";
import { addVotes } from "./utils";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "./ElectionContext";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined]
>): Promise<ElectionRegions> => {
  if (!queryKey[1]) {
    return [];
  }
  const response = await fetch(`/${queryKey[1]}/region_votes.json`);
  const data = await response.json();
  return data;
};
const queryFnParties = async ({
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
export const usePrevElectionRegionVotes = () => {
  const { priorElections } = useElectionContext();
  const { data: votes } = useQuery({
    queryKey: ["prev_region_votes", priorElections],
    queryFn,
    enabled: !!priorElections,
  });
  const { data: parties } = useQuery({
    queryKey: ["prev_parties", priorElections],
    queryFn: queryFnParties,
    enabled: !!priorElections,
  });

  const prevVotesByRegion = useCallback(
    (regionCode: string): (Votes & { nickName?: string })[] | undefined => {
      const r = votes?.find((vote) => vote.key === regionCode)?.results;

      if (r) {
        return r.votes.map((v) => ({
          ...v,
          nickName: parties?.find((p) => p.number === v.partyNum)?.nickName,
        }));
      }
      return undefined;
    },
    [parties, votes],
  );

  const prevCountryVotes = useCallback(() => {
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

    return acc.votes.map((v) => ({
      ...v,
      nickName: parties?.find((p) => p.number === v.partyNum)?.nickName,
    }));
  }, [parties, votes]);

  return {
    prevVotesByRegion,
    prevCountryVotes,
  };
};
