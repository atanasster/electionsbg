// /parliamentary/analysis — the parliamentary-election analyses hub. A single
// visual entry point to every election-analysis screen (risk, Benford, wasted
// votes, voter loyalty, comparison) and the tools & polling dossiers (coalition
// simulator, poll accuracy, campaign financing), replacing the long "избори"
// dropdown sections.
// Data comes from the pure ANALYSIS_CLUSTERS registry; layout from the reusable
// infographic tile-hub kit (src/ux/infographic). Each tile overlays the
// analysis's headline number for the selected election from the pre-generated
// analysis_stats.json (one fetch), then routes to the analysis's own screen.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  FeaturedStrip,
  HubHead,
  TileHubGrid,
  TileHubSection,
} from "@/ux/infographic";
import {
  ANALYSIS_BAND,
  analysisHubKpis,
  analysisKpiNote,
  promotedStats,
} from "./analysisHubFigures";
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
  const cta = t("analysis_hub_view");

  // statId → the tile that fronts it, so the band can label and link each cell from THIS
  // hub's own registry rather than restating it. A stat with no tile here gets no cell.
  const byStat = useMemo(
    () =>
      new Map(
        ANALYSIS_CLUSTERS.flatMap((c) =>
          c.analyses.flatMap((a) => (a.statId ? [[a.statId, a] as const] : [])),
        ),
      ),
    [],
  );
  const kpis = useMemo(
    () =>
      analysisHubKpis({
        band: ANALYSIS_BAND,
        stats,
        format: (st) => formatAnalysisMetric(st, i18n.language),
        formatInt: (n) => n.toLocaleString(i18n.language),
        labelOf: (id) => t(byStat.get(id)?.titleKey ?? id),
        hrefOf: (id) => byStat.get(id)?.to,
        t,
      }),
    [stats, i18n.language, byStat, t],
  );
  // DERIVED from the cells that rendered — an early cycle carries fewer analyses, and a
  // constant list would blank the tile of a stat whose cell was withheld.
  const promoted = useMemo(() => promotedStats(kpis), [kpis]);

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
        // §3.1 rule 5 — a figure is the band's OR the tile's, never both. A promoted tile
        // renders bare: `InfographicTile` guards its caption behind the metric, so a lone
        // caption would render nothing at all.
        ...(a.statId && promoted.has(a.statId)
          ? {}
          : {
              metric: formatAnalysisMetric(stat, i18n.language),
              metricCaption: analysisMetricCaption(stat, t, i18n.language),
            }),
      };
    }),
  }));

  return (
    <>
      <HubHead
        eyebrow={t("analysis_head_eyebrow")}
        title={t("analysis_head_title")}
        seoDescription={t("analysis_hub_seo_description")}
        deck={t("analysis_head_deck")}
        kpis={kpis}
        kpiNote={analysisKpiNote(kpis, t)}
      />

      <div data-og="analysis-hub">
        <TileHubGrid sections={sections} className="mt-4 sm:mt-6" />
      </div>

      {/* Curated reports — a few flagship anomaly reports, with a link to the
          full /reports hub for the rest (mirrors the procurement hub's featured
          sectors → all sectors strip). */}
      <FeaturedStrip
        className="mt-8"
        heading={t("reports_strip_heading")}
        action={{
          to: "/parliamentary/reports",
          label: t("reports_hub_see_all"),
        }}
        tiles={FEATURED_REPORTS.map((r) => {
          const stat = r.statId ? stats?.[r.statId] : undefined;
          return {
            to: r.to,
            title: t(r.titleKey),
            desc: t(r.descKey),
            accent: r.accent,
            scene: REPORT_SCENES[r.id],
            cta: t("reports_hub_view"),
            // ⚠️ RULE 5 REACHES THIS STRIP TOO, and it is the easy half to miss: the
            // featured `riskScore` report carries `statId: "risk"` — the SAME figure the
            // band promotes — so without this „6" printed twice on one page, once under
            // „Анализ на изборния риск" pointing at /risk-analysis and once under „Рисков
            // скор" pointing at /risk-score. Two labels and two destinations for one number
            // is worse than a plain duplicate.
            ...(r.statId && promoted.has(r.statId)
              ? {}
              : {
                  metric: formatAnalysisMetric(stat, i18n.language),
                  metricCaption: analysisMetricCaption(stat, t, i18n.language),
                }),
          };
        })}
      />
    </>
  );
};
