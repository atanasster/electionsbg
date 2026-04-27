import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Vote } from "lucide-react";
import { PaperMachineSummary } from "@/data/dashboard/dashboardTypes";
import { formatPct, formatThousands, localDate } from "@/data/utils";
import { StatCard } from "../StatCard";

type Props = {
  paperMachine?: PaperMachineSummary;
  priorElection?: string;
};

export const CandidatePaperMachineCard: FC<Props> = ({
  paperMachine,
  priorElection,
}) => {
  const { t } = useTranslation();
  if (!paperMachine) return null;
  const { paperPct, machinePct, deltaPaperPct, paperVotes, machineVotes } =
    paperMachine;
  const onlyPaper = machinePct === 0;
  const onlyMachine = paperPct === 0;
  const sign = (deltaPaperPct ?? 0) >= 0 ? "+" : "";
  const accent =
    deltaPaperPct === undefined
      ? "text-muted-foreground"
      : deltaPaperPct > 0
        ? "text-positive"
        : deltaPaperPct < 0
          ? "text-negative"
          : "text-muted-foreground";

  return (
    <StatCard
      label={t("dashboard_candidate_paper_machine")}
      hint={t("dashboard_candidate_paper_machine_hint")}
    >
      <div className="flex items-baseline gap-2">
        <Vote className="h-5 w-5 text-muted-foreground shrink-0" />
        <span className="text-2xl font-bold tabular-nums">
          {formatPct(paperPct, 1)}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("paper_votes").toLowerCase()}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="absolute top-0 bottom-0 left-0 bg-amber-500"
          style={{ width: `${paperPct}%` }}
        />
        <div
          className="absolute top-0 bottom-0 right-0 bg-sky-500"
          style={{ width: `${machinePct}%` }}
        />
      </div>
      {!onlyPaper &&
      !onlyMachine &&
      deltaPaperPct !== undefined &&
      priorElection ? (
        <div className={`text-sm font-medium tabular-nums ${accent}`}>
          {sign}
          {formatPct(deltaPaperPct, 2)} {t("dashboard_pct_points")}{" "}
          {t("paper_votes").toLowerCase()}
          <span className="text-xs text-muted-foreground ml-1">
            {t("dashboard_vs")} {localDate(priorElection)}
          </span>
        </div>
      ) : null}
      <div className="text-xs text-muted-foreground tabular-nums">
        {formatThousands(paperVotes)} {t("paper_votes").toLowerCase()} ·{" "}
        {formatThousands(machineVotes)} {t("machine_votes").toLowerCase()}
      </div>
    </StatCard>
  );
};
