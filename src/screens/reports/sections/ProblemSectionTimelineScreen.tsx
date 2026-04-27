import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useProblemSections } from "@/data/reports/useProblemSections";
import { useProblemSectionsStats } from "@/data/reports/useProblemSectionsStats";
import { BubbleTimeline } from "@/screens/timeline/BubbleTimeline";
import { useConsolidatedLabel } from "@/screens/components/useConsolidatedLabel";

export const ProblemSectionTimelineScreen: FC = () => {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { data: report } = useProblemSections();
  const { data: stats } = useProblemSectionsStats();
  const {
    colorFor,
    canonicalIdFor,
    consolidationIdFor,
    fullNameFor,
    displayNameFor,
  } = useCanonicalParties();
  const { isConsolidated, consolidated } = useConsolidatedLabel();

  const neighborhood = report?.neighborhoods.find((n) => n.id === id);
  if (!neighborhood) return null;

  const name = isBg ? neighborhood.name_bg : neighborhood.name_en;
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
