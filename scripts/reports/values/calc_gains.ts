import { PartyVotes, StatsVote } from "@/data/dataTypes";
import { CalcProcProps, CalcRowType, round } from "../report_types";
import { findPrevVotes } from "@/data/utils";
import { topPartyValues } from "./top_party";

export const calcGainsProc = (
  { votes, parties, prevYearParties, prevYearVotes, protocol }: CalcProcProps,
  top: boolean,
) => {
  if (!prevYearVotes) {
    return undefined;
  }
  const prevElectionVotes: StatsVote[] | undefined = prevYearVotes
    ?.map((v) => {
      const p = prevYearParties?.find((p1) => p1.number === v.partyNum);
      if (!p) {
        return undefined;
      }
      const { nickName, number, commonName } = p;
      return { ...v, number, nickName, commonName };
    })
    .filter((p) => p !== undefined);
  const partyVotes: PartyVotes[] = votes.map((v) => {
    const p = parties.find((p1) => p1.number === v.partyNum);
    return { ...v, ...p };
  });
  const changes = partyVotes
    .map((pv) => {
      const { prevTotalVotes } = findPrevVotes(pv, prevElectionVotes, true);
      return prevTotalVotes
        ? {
            ...pv,
            change: 100 * ((pv.totalVotes - prevTotalVotes) / prevTotalVotes),
            prevVotes: prevTotalVotes,
          }
        : undefined;
    })
    .filter((a) => a !== undefined)
    .sort((a, b) => b.change - a.change);
  if (changes.length > 0) {
    const change = top ? changes[0] : changes[changes.length - 1];
    return {
      ...topPartyValues(votes, protocol, (vt) =>
        vt.find((v) => v.partyNum === change.partyNum),
      ),
      value: round(change.change),
      prevYearVotes: change.prevVotes,
    } as CalcRowType;
  }
  return undefined;
};
