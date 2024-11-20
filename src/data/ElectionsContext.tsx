import { useEffect, useState } from "react";
import { PartyInfo, PartyVotes, Votes } from "./dataTypes";

export const useElectionInfo = () => {
  const [parties, setParties] = useState<PartyInfo[]>([]);
  useEffect(() => {
    fetch("/2024_10/cik_parties.json")
      .then((response) => response.json())
      .then((data) => {
        setParties(data);
      });
  }, []);

  const findParty = (partyNum: number) =>
    parties.find((p) => p.number === partyNum);
  const topVotesParty = (votes?: Votes[]): PartyVotes | undefined => {
    const tp = votes?.reduce((acc, curr) => {
      if (acc.totalVotes > curr.totalVotes) {
        return acc;
      }
      return curr;
    }, votes[0]);

    return tp ? ({ ...tp, ...findParty(tp.key) } as PartyVotes) : undefined;
  };

  return { findParty, topVotesParty };
};
