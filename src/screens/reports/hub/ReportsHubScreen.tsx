// /parliamentary/reports — the parliamentary-election anomaly-report hub. The
// standalone home for the report matrix (risk signals, votes & turnout, recount
// & machine flash-memory), which the analyses hub spotlights via a curated 3-up
// strip + a "виж всички →" link here. Same reusable tile-hub kit as the analyses
// and sectors hubs; each tile deep-links its report to a default grain and
// overlays the selected election's number where analysis_stats.json carries one.

import { FC, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { HubHead, TileHubGrid, TileHubSection } from "@/ux/infographic";
import {
  REPORTS_BAND,
  analysisHubKpis,
  analysisKpiNote,
  groupedInt,
  promotedStats,
} from "@/screens/analysis/analysisHubFigures";
import { useElectionContext } from "@/data/ElectionContext";
import { localDate } from "@/data/utils";
import { useAnalysisHubEvidence } from "@/screens/analysis/useAnalysisHubEvidence";
import {
  useAnalysisStatsState,
  formatAnalysisMetric,
  analysisMetricCaption,
} from "@/data/analysis/useAnalysisStats";
import { REPORT_CLUSTERS } from "./reportsHubRegistry";
import { REPORT_SCENES } from "./reportsHubScenes";

export const ReportsHubScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { stats, isPending } = useAnalysisStatsState();
  // ⚠️ ALWAYS-GROUPED — bg does not group four digits on its own; see `groupedInt`.
  const formatInt = useMemo(() => groupedInt(i18n.language), [i18n.language]);
  const { electionStats, selected } = useElectionContext();
  const cta = t("reports_hub_view");

  // statId → the report that fronts it, from THIS hub's registry — `risk` points at
  // /risk-score here and at /risk-analysis on the analysis hub, so the destination cannot be
  // shared with the band module.
  //
  // ⚠️ THE CAPABILITY FILTER APPLIES HERE TOO. A report gated on `requires` is absent for
  // cycles that lack it, and a band cell linking to a tile the page does not render would be
  // a figure with nowhere to go.
  //
  // ⚠️ ONE PREDICATE, USED TWICE — never two copies of the condition. The invariant above is
  // that the band's destinations are a subset of the tiles the page renders, and it rests
  // entirely on the two filters agreeing; written out twice, a new gate flag added to one
  // leaves a band cell pointing at a tile that is not on the page, which nothing here can
  // see (no gated report carries a `statId` today, so the filter is inert for the band and
  // a test cannot exercise it — see ReportsHubScreen.test.tsx).
  const isAvailable = useCallback(
    (r: { requires?: keyof NonNullable<typeof electionStats> }) =>
      !r.requires || !!electionStats?.[r.requires],
    [electionStats],
  );
  const byStat = useMemo(
    () =>
      new Map(
        REPORT_CLUSTERS.flatMap((c) =>
          c.reports
            .filter(isAvailable)
            .flatMap((r) => (r.statId ? [[r.statId, r] as const] : [])),
        ),
      ),
    [isAvailable],
  );
  const kpis = useMemo(
    () =>
      analysisHubKpis({
        band: REPORTS_BAND,
        stats,
        format: (st) => formatAnalysisMetric(st, i18n.language),
        formatInt,
        labelOf: (id) => t(byStat.get(id)?.titleKey ?? id),
        hrefOf: (id) => byStat.get(id)?.to,
        t,
      }),
    [stats, formatInt, i18n.language, byStat, t],
  );
  const promoted = useMemo(() => promotedStats(kpis), [kpis]);
  // The rail: how the other 12,699 sections fall out. It answers the band's first cell —
  // „is six a lot?" — which the cell cannot answer about itself.
  const evidence = useAnalysisHubEvidence(
    byStat.get("risk")?.to,
    formatInt,
    kpis.some((k) => k.statId === "risk"),
  );

  const sections: TileHubSection[] = REPORT_CLUSTERS.map((cluster) => ({
    heading: t(cluster.labelKey),
    // A capability-gated report (recount / flash-memory) only shows for
    // elections that actually have it, so cycles with no recount or no machine
    // vote don't surface an empty report.
    tiles: cluster.reports.filter(isAvailable).map((r) => {
      const stat = r.statId ? stats?.[r.statId] : undefined;
      return {
        to: r.to,
        title: t(r.titleKey),
        desc: t(r.descKey),
        accent: r.accent,
        scene: REPORT_SCENES[r.id],
        cta,
        // §3.1 rule 5 — see AnalysisHubScreen; a promoted tile renders bare, because
        // `InfographicTile` guards its caption behind the metric.
        ...(r.statId && promoted.has(r.statId)
          ? {}
          : {
              metric: formatAnalysisMetric(stat, i18n.language),
              metricCaption: analysisMetricCaption(stat, t, i18n.language),
            }),
      };
    }),
  })).filter((section) => section.tiles.length > 0);

  return (
    <>
      <HubHead
        // ⚠️ THE ELECTION IS IN THE EYEBROW, because a SHARE CARD IS SEEN WITHOUT ITS
        // PAGE. Every figure on this head comes from `/${selected}/analysis_stats.json`,
        // and the control that picks the cycle sits in the site header — outside the card's
        // frame. So an undated card publishes „6 секции в критичната лента" about no stated
        // election, on a page whose whole subject is electoral integrity. Same fix
        // /indicators took, one line up rather than per basis: here every cell shares ONE
        // cycle, so dating each of them would repeat the same date four times.
        eyebrow={t("reports_head_eyebrow", { election: localDate(selected) })}
        title={t("reports_head_title")}
        seoDescription={t("reports_hub_seo_description")}
        deck={t("reports_head_deck")}
        kpis={kpis}
        // ⚠️ THE PENDING COUNT, not `!stats` — a 404 is an ANSWER, and the early cycles carry
        // fewer analyses, so a tautological predicate leaves a permanently shimmering band.
        kpisPending={isPending ? REPORTS_BAND.length : undefined}
        kpiNote={analysisKpiNote(kpis, t)}
        evidence={evidence}
      />

      <div data-og="reports-hub">
        <TileHubGrid sections={sections} className="mt-4 sm:mt-6" />
      </div>
    </>
  );
};
