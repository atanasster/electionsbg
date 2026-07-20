import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Activity } from "lucide-react";
import { usePollsAccuracy } from "@/data/polls/usePolls";
import { Hint } from "@/ux/Hint";
import { Link } from "@/ux/Link";
import { AccuracyTrendsChart } from "@/screens/polls/AccuracyTrendsChart";
import { StatCard } from "./StatCard";

export const AccuracyTrendsTile: FC = () => {
  const { t } = useTranslation();
  const { data: accuracy } = usePollsAccuracy();

  // Match the chart's own guard so the tile chrome doesn't render an empty card.
  const enoughElections =
    (accuracy?.elections.filter((e) => e.agencies.length > 0).length ?? 0) >= 2;
  if (!enoughElections) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("dashboard_accuracy_trends_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              <span>{t("dashboard_accuracy_trends")}</span>
            </div>
          </Hint>
          <Link
            to="/polls"
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("dashboard_see_details")} →
          </Link>
        </div>
      }
      className="overflow-hidden"
    >
      <AccuracyTrendsChart />
    </StatCard>
  );
};
