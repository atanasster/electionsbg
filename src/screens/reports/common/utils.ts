import {
  PartyVotes,
  SectionProtocol,
  VoteResults,
  Votes,
} from "@/data/dataTypes";

export type ReportRow = {
  oblast?: string;
  obshtina?: string;
  partyVotes: PartyVotes;
  value: number;
  votes: Votes[];
  protocol: SectionProtocol;
  voterTurnout: number;
  pctSupportsNoOne: number;
  pctPartyVote: number;
  pctInvalidBallots: number;
  pctAdditionalVoters: number;
};

export type SettlementReportRow = ReportRow & {
  ekatte?: string;
};

export type SectionReportRow = SettlementReportRow & {
  section?: string;
};

export type ReportRule = {
  value: (
    votes: Votes[],
    protocol?: SectionProtocol,
  ) => { value: number; partyVotes: PartyVotes } | undefined;
  defaultThreshold: number;
  bigger: boolean;
};

export const calcReportRow = (
  reportRule: ReportRule,
  results: VoteResults,
  threshold: number,
  oblast?: string,
  obshtina?: string,
): ReportRow | undefined => {
  if (results.protocol) {
    const rule = reportRule.value(results.votes, results.protocol);

    if (rule) {
      const { value, partyVotes } = rule;
      if (typeof value === "number") {
        if (
          (reportRule.bigger && value > threshold) ||
          (!reportRule.bigger && value < threshold)
        ) {
          return {
            oblast,
            obshtina,
            partyVotes,
            value,
            voterTurnout:
              100 *
              (results.protocol.totalActualVoters /
                results.protocol.numRegisteredVoters),
            pctSupportsNoOne:
              100 *
              ((results.protocol.numValidNoOnePaperVotes +
                (results.protocol.numValidNoOneMachineVotes || 0)) /
                results.protocol.totalActualVoters),
            pctPartyVote:
              (100 * partyVotes.totalVotes) /
              (results.protocol.numValidVotes +
                (results.protocol.numValidMachineVotes || 0)),
            pctInvalidBallots:
              100 *
              (results.protocol.numInvalidBallotsFound /
                results.protocol.numPaperBallotsFound),
            pctAdditionalVoters:
              100 *
              (results.protocol.numAdditionalVoters /
                results.protocol.totalActualVoters),
            votes: results.votes,
            protocol: results.protocol,
          };
        }
      }
    }
  }
  return undefined;
};
