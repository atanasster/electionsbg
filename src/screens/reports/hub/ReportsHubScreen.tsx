// /reports — the "Доклади" hub. The standalone home for the anomaly-report
// matrix (risk signals, votes & turnout, recount & machine flash-memory), which
// the /analysis hub spotlights via a curated 3-up strip + a "виж всички →" link
// here. Same reusable tile-hub kit as the /analysis and sectors hubs; each tile
// deep-links its report to a default grain and overlays the selected election's
// number where analysis_stats.json already carries one (turnout, risk).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { TileHubGrid, TileHubSection } from "@/ux/infographic";
import {
  useAnalysisStats,
  formatAnalysisMetric,
  analysisMetricCaption,
} from "@/data/analysis/useAnalysisStats";
import { REPORT_CLUSTERS } from "./reportsHubRegistry";
import { REPORT_SCENES } from "./reportsHubScenes";

export const ReportsHubScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const stats = useAnalysisStats();
  const cta = t("reports_hub_view");

  const sections: TileHubSection[] = REPORT_CLUSTERS.map((cluster) => ({
    heading: t(cluster.labelKey),
    tiles: cluster.reports.map((r) => {
      const stat = r.statId ? stats?.[r.statId] : undefined;
      return {
        to: r.to,
        title: t(r.titleKey),
        desc: t(r.descKey),
        accent: r.accent,
        scene: REPORT_SCENES[r.id],
        cta,
        metric: formatAnalysisMetric(stat, i18n.language),
        metricCaption: analysisMetricCaption(stat, t, i18n.language),
      };
    }),
  }));

  return (
    <>
      <Title description={t("reports_hub_seo_description")}>
        {t("reports_hub_title")}
      </Title>

      <div data-og="reports-hub">
        <TileHubGrid sections={sections} className="mt-4 sm:mt-6" />
      </div>
    </>
  );
};
