import { FC } from "react";
import { useTranslation } from "react-i18next";
import { LineChart } from "lucide-react";
import { useElectionContext } from "@/data/ElectionContext";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { BubbleTimeline } from "@/screens/timeline/BubbleTimeline";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

export const HistoricalTrendsTile: FC = () => {
  const { t } = useTranslation();
  const { stats } = useElectionContext();
  const { colorFor, canonicalIdFor, fullNameFor } = useCanonicalParties();

  if (!stats?.length) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("dashboard_historical_trends_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <LineChart className="h-4 w-4" />
              <span>{t("dashboard_historical_trends")}</span>
            </div>
          </Hint>
          <Link
            to="/timeline"
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("dashboard_see_details")} →
          </Link>
        </div>
      }
      className="overflow-hidden"
    >
      <BubbleTimeline
        stats={stats}
        colorFor={colorFor}
        lineageFor={canonicalIdFor}
        fullNameFor={fullNameFor}
        compact
      />
    </StatCard>
  );
};
