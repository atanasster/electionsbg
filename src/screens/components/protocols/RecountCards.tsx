import { RecountOriginal, VoteResults } from "@/data/dataTypes";
import { FC } from "react";
import { ProtocolCard } from "./ProtocolCard";
import { Hint } from "@/ux/Hint";
import { LabelXL } from "./LabelXL";
import { formatPct } from "@/data/utils";
import { RotateCcwSquare } from "lucide-react";
import { LabelL } from "./LabelL";
import { useTranslation } from "react-i18next";
import { ThousandsChange } from "@/ux/ThousandsChange";

export const RecountCards: FC<{
  results?: VoteResults;
  original?: RecountOriginal;
}> = ({ original, results }) => {
  const { t } = useTranslation();
  if (!original || !results) {
    return null;
  }

  if (results.protocol) {
    const totalVotesRecount =
      (results.protocol.numValidMachineVotes || 0) +
      (results.protocol.numValidVotes || 0);
    const machineVotesRecount = results.protocol.numValidMachineVotes || 0;
    const paperVotesRecount = results.protocol.numValidVotes || 0;
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 my-4">
        <ProtocolCard title={t("added")} icon={<RotateCcwSquare />}>
          <div className="flex">
            <Hint text={t("num_votes_recount_explainer")} underline={false}>
              <LabelXL>
                <ThousandsChange number={original.addedVotes} />
              </LabelXL>
            </Hint>
            {!!totalVotesRecount && (
              <Hint text={t("pct_votes_recount_explainer")} underline={false}>
                <LabelL>
                  {`(${formatPct((100 * original.addedVotes) / totalVotesRecount, 2)})`}
                </LabelL>
              </Hint>
            )}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <Hint text={t("num_paper_recount_explainer")}>
              <div>{`${t("paper_votes")}: `}</div>
            </Hint>
            <div className="flex">
              <Hint text={t("num_paper_recount_explainer")}>
                <ThousandsChange
                  className="font-bold"
                  number={original.addedPaperVotes}
                />
              </Hint>
              {!!paperVotesRecount && (
                <Hint text={t("pct_paper_recount_explainer")}>
                  <div className="font-bold text-primary ml-2">
                    {`(${formatPct((100 * original.addedPaperVotes) / paperVotesRecount, 2)})`}
                  </div>
                </Hint>
              )}
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
                  number={original.addedMachineVotes}
                />
              </Hint>
              {!!machineVotesRecount && (
                <Hint text={t("pct_machine_recount_explainer")}>
                  <div className="font-bold text-primary ml-2">
                    {`(${formatPct((100 * original.addedMachineVotes) / machineVotesRecount, 2)})`}
                  </div>
                </Hint>
              )}
            </div>
          </div>
        </ProtocolCard>
      </div>
    );
  } else {
    return null;
  }
};
