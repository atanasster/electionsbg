import { VoteResults } from "@/data/dataTypes";
import { FC } from "react";
import { ProtocolCard } from "./ProtocolCard";
import { Hint } from "@/ux/Hint";
import { LabelXL } from "./LabelXL";
import { formatPct, pctChange } from "@/data/utils";
import { RotateCcwSquare } from "lucide-react";
import { LabelL } from "./LabelL";
import { useTranslation } from "react-i18next";
import { ThousandsChange } from "@/ux/ThousandsChange";

export const RecountCards: FC<{
  results?: VoteResults;
  original?: VoteResults;
}> = ({ original, results }) => {
  const { t } = useTranslation();
  if (!original || !results) {
    return null;
  }
  const { protocol } = original;
  if (protocol && results.protocol) {
    const totalVotesOriginal =
      (protocol.numValidMachineVotes || 0) + (protocol.numValidVotes || 0);
    const totalVotesRecount =
      (results.protocol.numValidMachineVotes || 0) +
      (results.protocol.numValidVotes || 0);
    const machineVotesRecount = results.protocol.numValidMachineVotes || 0;
    const machineVotesOriginal = protocol.numValidMachineVotes || 0;

    const paperVotesRecount = results.protocol.numValidVotes || 0;
    const paperVotesOriginal = protocol.numValidVotes || 0;
    return (
      <>
        <ProtocolCard title={t("votes_recount")} icon={<RotateCcwSquare />}>
          <div className="flex">
            <Hint text={t("num_votes_recount_explainer")} underline={false}>
              <LabelXL>
                <ThousandsChange
                  number={totalVotesRecount - totalVotesOriginal}
                />
              </LabelXL>
            </Hint>
            <Hint text={t("pct_votes_recount_explainer")} underline={false}>
              <LabelL>
                {`(${formatPct(pctChange(totalVotesRecount, totalVotesOriginal), 2)})`}
              </LabelL>
            </Hint>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <Hint text={t("num_paper_recount_explainer")}>
              <div>{`${t("paper_votes")}: `}</div>
            </Hint>
            <div className="flex">
              <Hint text={t("num_paper_recount_explainer")}>
                <ThousandsChange
                  className="font-bold"
                  number={paperVotesRecount - paperVotesOriginal}
                />
              </Hint>
              <Hint text={t("pct_paper_recount_explainer")}>
                <div className="font-bold text-primary ml-2">
                  {`(${formatPct(pctChange(paperVotesRecount, paperVotesOriginal))})`}
                </div>
              </Hint>
            </div>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <Hint text={t("num_machine_recount_explainer")}>
              <div>{`${t("machine_votes")}: `}</div>
            </Hint>
            <div className="flex">
              <Hint text={t("num_machine_recount_explainer")}>
                <ThousandsChange
                  className="font-bold"
                  number={machineVotesRecount - machineVotesOriginal}
                />
              </Hint>
              <Hint text={t("pct_machine_recount_explainer")}>
                <div className="font-bold text-primary ml-2">
                  {`(${formatPct(pctChange(machineVotesRecount, machineVotesOriginal))})`}
                </div>
              </Hint>
            </div>
          </div>
        </ProtocolCard>
      </>
    );
  } else {
    return null;
  }
};
