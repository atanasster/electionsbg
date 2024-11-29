import { usePartyInfo } from "@/data/usePartyInfo";
import { ReportRule } from "./utils";
import { useMemo } from "react";
import { SectionProtocol, Votes } from "@/data/dataTypes";

export const useInvalidBallotsRule = (defaultThreshold: number) => {
  const { topVotesParty } = usePartyInfo();
  const reportRule: ReportRule = useMemo(
    () => ({
      value: (votes: Votes[], protocol?: SectionProtocol) => {
        const partyVotes = topVotesParty(votes);
        if (
          protocol &&
          partyVotes?.totalVotes &&
          protocol.numPaperBallotsFound
        ) {
          return {
            partyVotes,
            value:
              100 *
              ((protocol.numInvalidBallotsFound || 0) /
                protocol.numPaperBallotsFound),
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
