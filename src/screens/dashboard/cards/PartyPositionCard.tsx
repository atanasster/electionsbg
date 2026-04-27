import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Trophy, Award, Medal } from "lucide-react";
import { PartyDashboardSummary } from "@/data/dashboard/partyDashboardTypes";
import { localDate } from "@/data/utils";
import { StatCard } from "../StatCard";

type Props = { data: PartyDashboardSummary };

export const PartyPositionCard: FC<Props> = ({ data }) => {
  const { t } = useTranslation();
  const Icon =
    data.position === 1 ? Trophy : data.position <= 3 ? Award : Medal;
  const delta = data.deltaPosition;
  const sign =
    delta !== undefined && delta > 0
      ? "↑"
      : delta !== undefined && delta < 0
        ? "↓"
        : "=";
  const accent =
    delta === undefined
      ? "text-muted-foreground"
      : delta > 0
        ? "text-positive"
        : delta < 0
          ? "text-negative"
          : "text-muted-foreground";

  return (
    <StatCard label={t("position")} hint={t("dashboard_party_position_hint")}>
      <div className="flex items-baseline gap-2">
        <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
        <span className="text-2xl font-bold tabular-nums">
          {data.position || "—"}
        </span>
        {data.passedThreshold ? (
          <span className="text-xs text-positive font-medium uppercase tracking-wide">
            {t("dashboard_above_threshold")}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground uppercase tracking-wide">
            {t("dashboard_below_threshold")}
          </span>
        )}
      </div>
      {delta !== undefined && data.priorPosition !== undefined && (
        <div className={`text-sm font-medium tabular-nums ${accent}`}>
          {sign} {Math.abs(delta) || "—"}{" "}
          {Math.abs(delta) === 1
            ? t("dashboard_position").toLowerCase()
            : t("dashboard_positions").toLowerCase()}
        </div>
      )}
      {data.priorPosition !== undefined && (
        <div className="text-xs text-muted-foreground tabular-nums">
          #{data.priorPosition} → #{data.position}
          {data.priorElection && (
            <span className="ml-1">({localDate(data.priorElection)})</span>
          )}
        </div>
      )}
    </StatCard>
  );
};
