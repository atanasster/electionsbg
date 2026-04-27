import { FC } from "react";
import { useTranslation } from "react-i18next";
import { TrendingUp } from "lucide-react";
import { CandidateDashboardSummary } from "@/data/dashboard/candidateDashboardTypes";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";
import { CandidateHistoryChart } from "@/screens/components/candidates/CandidateHistoryChart";

type Props = { data: CandidateDashboardSummary };

export const CandidateTrajectoryTile: FC<Props> = ({ data }) => {
  const { t } = useTranslation();
  if (!data.history || data.history.length < 2) return null;
  return (
    <StatCard
      label={
        <Hint text={t("dashboard_candidate_trajectory_hint")} underline={false}>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            <span>{t("preferences_history")}</span>
          </div>
        </Hint>
      }
      className="overflow-hidden"
    >
      <div className="w-full mt-2">
        <CandidateHistoryChart stats={data.history} />
      </div>
    </StatCard>
  );
};
