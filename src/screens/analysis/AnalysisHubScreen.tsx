// /analysis — the "Анализи" hub. A single visual entry point to every
// election-analysis screen (risk, Benford, wasted votes, voter loyalty,
// comparison) and the tools & polling dossiers (coalition simulator, poll
// accuracy, campaign financing), replacing the long "избори" dropdown sections.
// Data comes from the pure ANALYSIS_CLUSTERS registry; layout from the reusable
// infographic tile-hub kit (src/ux/infographic). Each tile overlays the
// analysis's headline number for the selected election from the pre-generated
// analysis_stats.json (one fetch), then routes to the analysis's own screen.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { TileHubGrid, TileHubSection } from "@/ux/infographic";
import {
  useAnalysisStats,
  formatAnalysisMetric,
  analysisMetricCaption,
} from "@/data/analysis/useAnalysisStats";
import { ANALYSIS_CLUSTERS } from "./analysisRegistry";
import { ANALYSIS_SCENES } from "./analysisScenes";

export const AnalysisHubScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const stats = useAnalysisStats();
  const title = t("analysis_hub_title");
  const cta = t("analysis_hub_view");

  const sections: TileHubSection[] = ANALYSIS_CLUSTERS.map((cluster) => ({
    heading: t(cluster.labelKey),
    tiles: cluster.analyses.map((a) => {
      const stat = a.statId ? stats?.[a.statId] : undefined;
      return {
        to: a.to,
        title: t(a.titleKey),
        desc: t(a.descKey),
        accent: a.accent,
        scene: ANALYSIS_SCENES[a.id],
        cta,
        metric: formatAnalysisMetric(stat, i18n.language),
        metricCaption: analysisMetricCaption(stat, t, i18n.language),
      };
    }),
  }));

  return (
    <>
      <Title description={t("analysis_hub_seo_description")}>{title}</Title>

      <div data-og="analysis-hub">
        <TileHubGrid sections={sections} className="mt-4 sm:mt-6" />
      </div>
    </>
  );
};
