import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useMunicipalityStats } from "@/data/municipalities/useMunicipalityStats";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { BubbleTimeline } from "./timeline/BubbleTimeline";
import { useConsolidatedLabel } from "./components/useConsolidatedLabel";

export const MunicipalityTimelineScreen: FC = () => {
  const { id: muniCode } = useParams();
  const { findMunicipality } = useMunicipalities();
  const { stats } = useMunicipalityStats(muniCode);
  const {
    colorFor,
    canonicalIdFor,
    consolidationIdFor,
    fullNameFor,
    displayNameFor,
  } = useCanonicalParties();
  const { isConsolidated, consolidated } = useConsolidatedLabel();
  const { t, i18n } = useTranslation();
  if (!muniCode) return null;
  const info = findMunicipality(muniCode);
  const name =
    (i18n.language === "bg"
      ? info?.long_name || info?.name
      : info?.long_name_en || info?.name_en) || muniCode;
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
