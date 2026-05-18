import { FC } from "react";
import { useTranslation } from "react-i18next";
import { LineChart } from "lucide-react";
import { useElectionContext } from "@/data/ElectionContext";
import { ElectionInfo } from "@/data/dataTypes";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useRegionStats } from "@/data/regions/useRegionStats";
import { useConsolidated } from "@/data/useConsolidated";
import { BubbleTimeline } from "@/screens/timeline/BubbleTimeline";
import { Hint } from "@/ux/Hint";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useTouch } from "@/ux/TouchProvider";
import { StatCard } from "./StatCard";

type Props = {
  regionCode?: string;
  stats?: ElectionInfo[];
};

export const HistoricalTrendsTile: FC<Props> = ({
  regionCode,
  stats: providedStats,
}) => {
  const { t } = useTranslation();
  const isTouch = useTouch();
  const { stats: nationalStats } = useElectionContext();
  const { stats: regionStats } = useRegionStats(
    providedStats ? null : regionCode,
  );
  const stats = providedStats
    ? providedStats
    : regionCode
      ? regionStats
      : nationalStats;
  const {
    colorFor,
    canonicalIdFor,
    consolidationIdFor,
    fullNameFor,
    displayNameFor,
    displayNameForId,
  } = useCanonicalParties();
  const { isConsolidated, setIsConsolidated } = useConsolidated();

  if (!stats?.length) return null;

  const switchId = "historical-trends-consolidated";

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <Hint text={t("dashboard_historical_trends_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <LineChart className="h-4 w-4" />
              <span>{t("dashboard_historical_trends")}</span>
            </div>
          </Hint>
          <Hint text={t("consolidated_data_explainer")} underline={false}>
            <div className="flex items-center gap-2">
              <Switch
                id={switchId}
                checked={isConsolidated}
                onCheckedChange={setIsConsolidated}
              />
              <Label
                className="text-[10px] normal-case text-muted-foreground font-normal"
                htmlFor={isTouch ? undefined : switchId}
              >
                {t("consolidated_data")}
              </Label>
            </div>
          </Hint>
        </div>
      }
      className="overflow-hidden"
    >
      <BubbleTimeline
        stats={stats}
        colorFor={colorFor}
        lineageFor={isConsolidated ? consolidationIdFor : canonicalIdFor}
        fullNameFor={fullNameFor}
        displayNameFor={displayNameFor}
        displayNameForId={displayNameForId}
        consolidated={isConsolidated}
        compact
      />
    </StatCard>
  );
};
