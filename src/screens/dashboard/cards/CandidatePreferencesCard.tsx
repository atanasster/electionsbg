import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Vote, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { CandidateDashboardSummary } from "@/data/dashboard/candidateDashboardTypes";
import { formatPct, formatThousands, localDate } from "@/data/utils";
import { StatCard } from "../StatCard";

type Props = { data: CandidateDashboardSummary };

export const CandidatePreferencesCard: FC<Props> = ({ data }) => {
  const { t } = useTranslation();
  const delta = data.deltaPct;
  const sign = (delta ?? 0) >= 0 ? "+" : "";
  const Icon =
    delta === undefined
      ? Minus
      : delta > 0
        ? TrendingUp
        : delta < 0
          ? TrendingDown
          : Minus;
  const accent =
    delta === undefined
      ? "text-muted-foreground"
      : delta > 0
        ? "text-positive"
        : delta < 0
          ? "text-negative"
          : "text-muted-foreground";

  return (
    <StatCard
      label={t("dashboard_candidate_preferences")}
      hint={t("dashboard_candidate_preferences_hint")}
    >
      <div className="flex items-baseline gap-2">
        <Vote className="h-5 w-5 text-muted-foreground shrink-0" />
        <span className="text-2xl font-bold tabular-nums">
          {formatThousands(data.totalVotes)}
        </span>
        {data.pctOfPartyPrefs !== undefined && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatPct(data.pctOfPartyPrefs, 2)} {t("dashboard_of_party_prefs")}
          </span>
        )}
      </div>
      {delta !== undefined && (
        <div className={`text-sm font-medium tabular-nums ${accent}`}>
          <Icon className="inline h-4 w-4 mr-1 -mt-0.5" />
          {sign}
          {formatPct(delta, 1)}
          {data.priorElection && (
            <span className="text-xs text-muted-foreground ml-1">
              {t("dashboard_vs")} {localDate(data.priorElection)}
            </span>
          )}
        </div>
      )}
      {data.priorTotalVotes !== undefined && (
        <div className="text-xs text-muted-foreground tabular-nums">
          {formatThousands(data.priorTotalVotes)} →{" "}
          {formatThousands(data.totalVotes)}
        </div>
      )}
    </StatCard>
  );
};
