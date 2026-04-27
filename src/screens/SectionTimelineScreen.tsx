import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useSectionStats } from "@/data/sections/useSectionStats";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { BubbleTimeline } from "./timeline/BubbleTimeline";
import { useConsolidatedLabel } from "./components/useConsolidatedLabel";

export const SectionTimelineScreen: FC = () => {
  const { id: sectionCode } = useParams();
  const { stats } = useSectionStats(sectionCode);
  const {
    colorFor,
    canonicalIdFor,
    consolidationIdFor,
    fullNameFor,
    displayNameFor,
  } = useCanonicalParties();
  const { isConsolidated, consolidated } = useConsolidatedLabel();
  const { t } = useTranslation();
  if (!sectionCode) return null;
  const name = `${t("section")} ${sectionCode}`;
  const title = `${name} — ${t("dashboard_historical_trends")}`;
  return (
    <div className="w-full max-w-6xl mx-auto px-4 pb-12">
      <Title description={t("timeline_description")}>{title}</Title>
      <p className="text-sm text-muted-foreground mb-6 max-w-3xl">
        {t("timeline_explainer")}
      </p>
      <div className="flex justify-end">{consolidated}</div>
      {stats && (
        <BubbleTimeline
          stats={stats}
          colorFor={colorFor}
          lineageFor={isConsolidated ? consolidationIdFor : canonicalIdFor}
          fullNameFor={fullNameFor}
          displayNameFor={displayNameFor}
          consolidated={isConsolidated}
        />
      )}
      <p className="text-xs text-muted-foreground mt-4">
        {t("timeline_legend_hint")}
      </p>
    </div>
  );
};
