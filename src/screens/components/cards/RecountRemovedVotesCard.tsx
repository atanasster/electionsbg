import { RecountStats, Votes } from "@/data/dataTypes";
import { Hint } from "@/ux/Hint";
import { ProtocolCard } from "@/ux/ProtocolCard";
import { FileMinus } from "lucide-react";
import { FC } from "react";
import { LabelXL } from "../protocols/LabelXL";
import { ThousandsChange } from "@/ux/ThousandsChange";
import { formatPct } from "@/data/utils";
import { LabelL } from "../protocols/LabelL";
import { useTranslation } from "react-i18next";

export const RecountRemovedVotesCard: FC<{
  original: RecountStats;
  votes: Votes[];
}> = ({ original, votes }) => {
  const { t } = useTranslation();
  const { machineVotes, paperVotes } = votes.reduce(
    (acc: { machineVotes: number; paperVotes: number }, vote) => {
      return {
        machineVotes: acc.machineVotes + (vote.machineVotes || 0),
        paperVotes: acc.paperVotes + (vote.paperVotes || 0),
      };
    },
    { machineVotes: 0, paperVotes: 0 },
  );
  const totalVotesRecount = machineVotes + paperVotes;
  const machineVotesRecount = machineVotes;
  const paperVotesRecount = paperVotes;
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
          {!!original.removedPaperVotes && (
            <div className="font-bold text-primary ml-2">
              {`(${formatPct(paperVotesRecount ? (100 * original.removedPaperVotes) / paperVotesRecount : -100, 2)})`}
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
          {!!original.removedMachineVotes && (
            <div className="font-bold text-primary ml-2">
              {`(${formatPct(machineVotesRecount ? (100 * original.removedMachineVotes) / machineVotesRecount : -100, 2)})`}
            </div>
          )}
        </div>
      </div>
    </ProtocolCard>
  );
};
