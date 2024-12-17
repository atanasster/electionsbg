import { useMemo } from "react";
import { PartyVotes, Votes } from "../dataTypes";
import { usePartyInfo } from "./usePartyInfo";

export const useTopParties = (
  votes?: Votes[],
  pctThreshold?: number,
): PartyVotes[] | undefined => {
  const { findParty } = usePartyInfo();
  const topParties = useMemo(() => {
    const totalVotes = votes?.reduce((acc, v) => acc + v.totalVotes, 0);
    return votes
      ?.sort((a, b) => b.totalVotes - a.totalVotes)
      .filter((v, idx) => {
        if (!findParty(v.partyNum)) {
          return false;
        }
        if (pctThreshold) {
          const pctVotes = totalVotes ? (100 * v?.totalVotes) / totalVotes : 0;
          return pctVotes >= pctThreshold || (idx < 5 && v.totalVotes > 0);
        } else {
          return true;
        }
      })
      .map((v) => {
        const party = findParty(v.partyNum);
        const pctVotes = totalVotes ? (100 * v?.totalVotes) / totalVotes : 0;
        return {
          ...v,
          nickName: party?.nickName,
          commonName: party?.commonName,
          color: party?.color,
          name: party?.name,
          pctVotes,
        };
      });
  }, [findParty, pctThreshold, votes]);
  return topParties;
};
