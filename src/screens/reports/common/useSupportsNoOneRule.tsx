import { usePartyInfo } from "@/data/ElectionsContext";
import { useMemo } from "react";
import { ReportRule } from "./utils";
import { SectionProtocol, Votes } from "@/data/dataTypes";

export const useSupportsNoOneRule = (defaultThreshold: number) => {
  const { topVotesParty } = usePartyInfo();
  const reportRule: ReportRule = useMemo(
    () => ({
      value: (votes: Votes[], protocol?: SectionProtocol) => {
        const partyVotes = topVotesParty(votes);
        if (protocol && partyVotes?.totalVotes) {
          return {
            partyVotes,
            value:
              100 *
              ((protocol.numValidNoOnePaperVotes +
                (protocol.numValidNoOneMachineVotes || 0)) /
                protocol.totalActualVoters),
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
