import { useElectionInfo } from "@/data/ElectionsContext";
import { ReportRule } from "./utils";
import { useMemo } from "react";
import { SectionProtocol, Votes } from "@/data/dataTypes";

export const useInvalidBallotsRule = (defaultThreshold: number) => {
  const { topVotesParty } = useElectionInfo();
  const reportRule: ReportRule = useMemo(
    () => ({
      value: (votes: Votes[], protocol?: SectionProtocol) => {
        const partyVotes = topVotesParty(votes);
        if (protocol && partyVotes?.totalVotes) {
          return {
            partyVotes,
            value:
              100 *
              (protocol.numInvalidBallotsFound / protocol.numPaperBallotsFound),
          };
        }
        return undefined;
      },
      defaultThreshold: defaultThreshold,
      bigger: true,
    }),
    [topVotesParty, defaultThreshold],
  );
  return reportRule;
};
