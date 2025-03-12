import { RecountStats, Votes } from "@/data/dataTypes";
import { Hint } from "@/ux/Hint";
import { ProtocolCard } from "@/ux/ProtocolCard";
import { FilePlus } from "lucide-react";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { LabelXL } from "../protocols/LabelXL";
import { ThousandsChange } from "@/ux/ThousandsChange";
import { formatPct } from "@/data/utils";
import { LabelL } from "../protocols/LabelL";

export const RecountAddedVotesCard: FC<{
  original: RecountStats;
  votes: Votes[];
}> = ({ original, votes }) => {
  const { t } = useTranslation();
  const { machineVotes, paperVotes } = useMemo(
    () =>
      votes.reduce(
        (acc: { machineVotes: number; paperVotes: number }, vote) => {
          return {
            machineVotes: acc.machineVotes + (vote.machineVotes || 0),
            paperVotes: acc.paperVotes + (vote.paperVotes || 0),
          };
        },
        { machineVotes: 0, paperVotes: 0 },
      ),
    [votes],
  );
  const totalVotesRecount = machineVotes + paperVotes;
  const machineVotesRecount = machineVotes;
  const paperVotesRecount = paperVotes;
  return (
    <ProtocolCard title={t("added_votes")} icon={<FilePlus />}>
      <div className="flex">
        <Hint text={t("added_votes_recount_explainer")} underline={false}>
          <LabelXL>
            <ThousandsChange number={original.addedVotes} />
          </LabelXL>
        </Hint>
        {!!totalVotesRecount && (
          <Hint text={t("pct_added_recount_explainer")} underline={false}>
            <LabelL>
              {`(${formatPct((100 * original.addedVotes) / totalVotesRecount, 2)})`}
            </LabelL>
          </Hint>
        )}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <div>{`${t("paper_votes")}: `}</div>
        <div className="flex">
          <ThousandsChange
            className="font-bold"
            number={original.addedPaperVotes}
          />
          {!!paperVotesRecount && (
            <div className="font-bold text-primary ml-2">
              {`(${formatPct((100 * original.addedPaperVotes) / paperVotesRecount, 2)})`}
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <div>{`${t("machine_votes")}: `}</div>
        <div className="flex">
          <ThousandsChange
            className="font-bold"
            number={original.addedMachineVotes}
          />
          {!!machineVotesRecount && (
            <div className="font-bold text-primary ml-2">
              {`(${formatPct((100 * original.addedMachineVotes) / machineVotesRecount, 2)})`}
            </div>
          )}
        </div>
      </div>
    </ProtocolCard>
  );
};
