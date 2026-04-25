import { FC } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { AnomalyCounts } from "@/data/dashboard/dashboardTypes";
import { StatCard } from "../StatCard";

type Props = {
  anomalies: AnomalyCounts;
};

// utils.formatThousands returns "" for 0 (falsy guard); we want to render "0".
// bg-BG uses U+00A0 (NBSP) as the thousands separator; \s matches it.
const fmt = (n: number) => n.toLocaleString("bg-BG").replace(/\s/g, ",");

const Row: FC<{ label: string; count: number }> = ({ label, count }) =>
  count > 0 ? (
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums font-medium">{fmt(count)}</span>
    </div>
  ) : null;

export const AnomaliesCard: FC<Props> = ({ anomalies }) => {
  const { t } = useTranslation();
  return (
    <StatCard
      label={t("dashboard_anomalies")}
      hint={t("dashboard_anomalies_hint")}
    >
      <div className="flex items-baseline gap-2">
        <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
        <span className="text-2xl font-bold tabular-nums">
          {fmt(anomalies.total)}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("dashboard_sections").toLowerCase()}
        </span>
      </div>
      <div className="flex flex-col gap-0.5 mt-1">
        <Row label={t("dashboard_anomaly_recount")} count={anomalies.recount} />
        <Row
          label={t("dashboard_anomaly_recount_zero")}
          count={anomalies.recountZeroVotes}
        />
        <Row
          label={t("dashboard_anomaly_suemg_added")}
          count={anomalies.suemgAdded}
        />
        <Row
          label={t("dashboard_anomaly_suemg_removed")}
          count={anomalies.suemgRemoved}
        />
        <Row
          label={t("dashboard_anomaly_suemg_missing")}
          count={anomalies.suemgMissingFlash}
        />
        <Row
          label={t("dashboard_anomaly_problem_sections")}
          count={anomalies.problemSections}
        />
      </div>
    </StatCard>
  );
};
