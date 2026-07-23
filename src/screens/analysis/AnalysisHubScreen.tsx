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
import { TileHubGrid, TileHubSection, FeaturedStrip } from "@/ux/infographic";
import {
  useAnalysisStats,
  formatAnalysisMetric,
  analysisMetricCaption,
} from "@/data/analysis/useAnalysisStats";
import { ANALYSIS_CLUSTERS } from "./analysisRegistry";
import { ANALYSIS_SCENES } from "./analysisScenes";
import { FEATURED_REPORTS } from "@/screens/reports/hub/reportsHubRegistry";
import { REPORT_SCENES } from "@/screens/reports/hub/reportsHubScenes";

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

      {/* Curated reports — a few flagship anomaly reports, with a link to the
          full /reports hub for the rest (mirrors the procurement hub's featured
          sectors → all sectors strip). */}
      <FeaturedStrip
        className="mt-8"
        heading={t("reports_hub_title")}
        action={{ to: "/reports", label: t("reports_hub_see_all") }}
        tiles={FEATURED_REPORTS.map((r) => {
          const stat = r.statId ? stats?.[r.statId] : undefined;
          return {
            to: r.to,
            title: t(r.titleKey),
            desc: t(r.descKey),
            accent: r.accent,
            scene: REPORT_SCENES[r.id],
            cta: t("reports_hub_view"),
            metric: formatAnalysisMetric(stat, i18n.language),
            metricCaption: analysisMetricCaption(stat, t, i18n.language),
          };
        })}
      />
    </>
  );
};
