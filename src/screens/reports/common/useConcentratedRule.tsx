import { usePartyInfo } from "@/data/usePartyInfo";
import { useMemo } from "react";
import { ReportRule } from "./utils";
import { SectionProtocol, Votes } from "@/data/dataTypes";

export const useConcentratedReportRule = (defaultThreshold: number) => {
  const { topVotesParty } = usePartyInfo();
  const reportRule: ReportRule = useMemo(
    () => ({
      value: (votes: Votes[], protocol?: SectionProtocol) => {
        const partyVotes = topVotesParty(votes);
        if (protocol && partyVotes?.totalVotes) {
          return {
            partyVotes,
            value:
              (100 * partyVotes.totalVotes) /
              (protocol.numValidVotes + (protocol.numValidMachineVotes || 0)),
          };
        }
        return undefined;
      },
      defaultThreshold,
      bigger: true,
    }),
    [topVotesParty, defaultThreshold],
  );
  return reportRule;
};
