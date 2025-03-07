import { RecountStats, SectionProtocol } from "@/data/dataTypes";
import { Hint } from "@/ux/Hint";
import { ProtocolCard } from "@/ux/ProtocolCard";
import { FileMinus } from "lucide-react";
import { FC } from "react";
import { useTranslation } from "react-i18next";
import { LabelXL } from "../protocols/LabelXL";
import { ThousandsChange } from "@/ux/ThousandsChange";
import { formatPct } from "@/data/utils";
import { LabelL } from "../protocols/LabelL";

export const RecountRemovedVotesCard: FC<{
  original: RecountStats;
  protocol?: SectionProtocol;
}> = ({ original, protocol }) => {
  const { t } = useTranslation();
  const totalVotesRecount =
    (protocol?.numValidMachineVotes || 0) + (protocol?.numValidVotes || 0);
  const machineVotesRecount = protocol?.numValidMachineVotes || 0;
  const paperVotesRecount = protocol?.numValidVotes || 0;

  return (
    <ProtocolCard title={t("removed_votes")} icon={<FileMinus />}>
      <div className="flex">
        <Hint text={t("removed_votes_recount_explainer")} underline={false}>
          <LabelXL>
            <ThousandsChange number={original.removedVotes} />
          </LabelXL>
        </Hint>
        {!!totalVotesRecount && (
          <Hint text={t("pct_removed_recount_explainer")} underline={false}>
            <LabelL>
              {`(${formatPct((100 * original.removedVotes) / totalVotesRecount, 2)})`}
            </LabelL>
          </Hint>
        )}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <div>{`${t("paper_votes")}: `}</div>
        <div className="flex">
          <ThousandsChange
            className="font-bold"
            number={original.removedPaperVotes}
          />
          {!!paperVotesRecount && (
            <div className="font-bold text-primary ml-2">
              {`(${formatPct((100 * original.removedPaperVotes) / paperVotesRecount, 2)})`}
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <div>{`${t("machine_votes")}: `}</div>
        <div className="flex">
          <ThousandsChange
            className="font-bold"
            number={original.removedMachineVotes}
          />
          {!!machineVotesRecount && (
            <div className="font-bold text-primary ml-2">
              {`(${formatPct((100 * original.removedMachineVotes) / machineVotesRecount, 2)})`}
            </div>
          )}
        </div>
      </div>
    </ProtocolCard>
  );
};
