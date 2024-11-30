import { usePartyInfo } from "@/data/usePartyInfo";
import { ReportRule } from "./utils";
import { useMemo } from "react";
import { SectionProtocol, Votes } from "@/data/dataTypes";

export const useAdditionalVotersRule = (defaultThreshold: number) => {
  const { topVotesParty } = usePartyInfo();
  const reportRule: ReportRule = useMemo(
    () => ({
      value: (votes: Votes[], protocol?: SectionProtocol) => {
        const partyVotes = topVotesParty(votes);
        if (protocol && partyVotes?.totalVotes && protocol.totalActualVoters) {
          return {
            partyVotes,
            value:
              100 *
              ((protocol.numAdditionalVoters || 0) /
                protocol.totalActualVoters),
          };
        }
        return undefined;
      },
      defaultThreshold,
      bigger: true,
    }),
    [defaultThreshold, topVotesParty],
  );
  return reportRule;
};
