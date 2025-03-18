import {
  PartyVotes,
  ReportRow,
  SectionProtocol,
  Votes,
} from "@/data/dataTypes";
import { topParty } from "@/data/utils";
import { round } from "../report_types";

type FindPartyFunc = (votes: Votes[]) => PartyVotes | undefined;
export const topPartyValues = (
  votes: Votes[],
  protocol?: SectionProtocol,
  findParty: FindPartyFunc = topParty,
): Pick<ReportRow, "partyNum" | "totalVotes" | "pctPartyVote"> | undefined => {
  const partyVotes = findParty(votes);
  if (protocol && partyVotes) {
    return {
      partyNum: partyVotes.partyNum,
      totalVotes: partyVotes.totalVotes,
      pctPartyVote: round(
        (100 * partyVotes.totalVotes) /
          ((protocol.numValidVotes || 0) +
            (protocol.numValidMachineVotes || 0)),
      ),
    };
  }
  return undefined;
};
