import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useSofiaStats } from "@/data/country/useSofiaStats";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { BubbleTimeline } from "./timeline/BubbleTimeline";
import { useConsolidatedLabel } from "./components/useConsolidatedLabel";

export const SofiaTimelineScreen: FC = () => {
  const { sofiaStats } = useSofiaStats();
  const {
    colorFor,
    canonicalIdFor,
    consolidationIdFor,
    fullNameFor,
    displayNameFor,
    displayNameForId,
  } = useCanonicalParties();
  const { isConsolidated, consolidated } = useConsolidatedLabel();
  const { t } = useTranslation();
  const title = `${t("sofia_city")} — ${t("dashboard_historical_trends")}`;
  return (
    <div className="w-full max-w-6xl mx-auto px-4 pb-12">
      <Title description={t("timeline_description")}>{title}</Title>
      <p className="text-sm text-muted-foreground mb-6 max-w-3xl">
        {t("timeline_explainer")}
      </p>
      <div className="flex justify-end">{consolidated}</div>
      {sofiaStats && (
        <BubbleTimeline
          stats={sofiaStats}
          colorFor={colorFor}
          lineageFor={isConsolidated ? consolidationIdFor : canonicalIdFor}
          fullNameFor={fullNameFor}
          displayNameFor={displayNameFor}
          displayNameForId={displayNameForId}
          consolidated={isConsolidated}
        />
      )}
      <p className="text-xs text-muted-foreground mt-4">
        {t("timeline_legend_hint")}
      </p>
    </div>
  );
};
