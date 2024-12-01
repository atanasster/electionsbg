import { useMemo } from "react";
import { Votes } from "./dataTypes";
import { usePartyInfo } from "./usePartyInfo";

export const useTopParties = (
  votes?: Votes[],
  pctThreshold: number = 4,
):
  | (Votes & {
      nickName?: string;
      color?: string;
      pctVotes?: number;
      partyName?: string;
    })[]
  | undefined => {
  const { findParty } = usePartyInfo();
  const topParties = useMemo(() => {
    const totalVotes = votes?.reduce((acc, v) => acc + v.totalVotes, 0);
    return votes
      ?.sort((a, b) => b.totalVotes - a.totalVotes)
      .filter((v, idx) => {
        const pctVotes = totalVotes ? (100 * v?.totalVotes) / totalVotes : 0;
        return pctVotes >= pctThreshold || (idx < 5 && v.totalVotes > 0);
      })
      .map((v) => {
        const party = findParty(v.partyNum);
        const pctVotes = totalVotes ? (100 * v?.totalVotes) / totalVotes : 0;
        return {
          ...v,
          nickName: party?.nickName,
          color: party?.color,
          partyName: party?.name,
          pctVotes,
        };
      });
  }, [findParty, pctThreshold, votes]);
  return topParties;
};
