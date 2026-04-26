import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { NationalSummary } from "@/data/dashboard/dashboardTypes";
import { formatPct, formatThousands, localDate } from "@/data/utils";
import { StatCard } from "../StatCard";

type Props = {
  turnout: NationalSummary["turnout"];
  priorElection?: string;
};

export const TurnoutCard: FC<Props> = ({ turnout, priorElection }) => {
  const { t } = useTranslation();
  const sign = (turnout.deltaPct ?? 0) >= 0 ? "+" : "";
  const accent =
    turnout.deltaPct === undefined
      ? "text-muted-foreground"
      : turnout.deltaPct >= 0
        ? "text-positive"
        : "text-negative";

  return (
    <StatCard label={t("dashboard_turnout")} hint={t("dashboard_turnout_hint")}>
      <div className="flex items-baseline gap-2">
        <Users className="h-5 w-5 text-muted-foreground shrink-0" />
        <span className="text-2xl font-bold tabular-nums">
          {formatPct(turnout.pct, 1)}
        </span>
      </div>
      {turnout.deltaPct !== undefined && turnout.priorPct !== undefined && (
        <div className={`text-sm font-medium tabular-nums ${accent}`}>
          {sign}
          {formatPct(turnout.deltaPct, 2)} {t("dashboard_pct_points")}
          {priorElection && (
            <span className="text-xs text-muted-foreground ml-1">
              {t("dashboard_vs")} {localDate(priorElection)}
            </span>
          )}
        </div>
      )}
      <div className="text-xs text-muted-foreground tabular-nums">
        {formatThousands(turnout.actual)} /{" "}
        {formatThousands(turnout.registered)}
      </div>
    </StatCard>
  );
};
