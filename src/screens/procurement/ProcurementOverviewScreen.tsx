// /procurement/overview — the procurement analytics deep-dive: money flows +
// CPV breakdown, who-wins / who-awards (treemaps + ranked tables + latest
// contracts), politicians & connections, risk signals, and the tender pipeline.
//
// This was the /procurement landing until that became a navigation hub
// (ProcurementScreen); the analytics moved here behind the hub's "Обзор" tile.
// The search lives on the hub now; this page keeps the shared KPI row + the
// section chrome (ProcurementNav + scope).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  ExternalLink,
  Users,
  Building2,
  AlertTriangle,
  ClipboardList,
  Waypoints,
} from "lucide-react";
import { Title } from "@/ux/Title";
import { DashboardSection } from "../dashboard/DashboardSection";
import { useProcurementOverview } from "@/data/procurement/useProcurementOverview";
import { ProcurementFlowTile } from "../components/procurement/ProcurementFlowTile";
import { WatchlistDigestTile } from "../components/procurement/WatchlistDigestTile";
import { ProcurementSectionHeader } from "../components/procurement/ProcurementSectionHeader";
import { ProcurementKpiRow } from "../components/procurement/ProcurementKpiRow";
import { ProcurementSectorsTile } from "../components/procurement/ProcurementSectorsTile";
import { RiskSignalsTile } from "../components/procurement/RiskSignalsTile";
import {
  RiskGradeLeaderboardTile,
  RISK_GRADE_BOARD_PREVIEW,
  RISK_GRADE_BOARD_MIN_SCORE,
} from "../components/procurement/RiskGradeLeaderboardTile";
import { useAwarderRiskTop } from "@/data/procurement/useAwarderRiskTop";
import { RecentAppealsTile } from "../components/procurement/RecentAppealsTile";
import { ProcurementBenchmarksTile } from "../components/procurement/ProcurementBenchmarksTile";
import { LatestContractsTile } from "../components/procurement/LatestContractsTile";
import { LatestTendersTile } from "../components/procurement/LatestTendersTile";
import { TopContractorsTile } from "../components/procurement/TopContractorsTile";
import { TopAwardersTile } from "../components/procurement/TopAwardersTile";
import { TopConnectedPeopleTile } from "../components/procurement/TopConnectedPeopleTile";
import { ProcurementTreemapTile } from "../components/procurement/ProcurementTreemapTile";

const SkeletonCard: FC = () => (
  <div className="h-[140px] animate-pulse rounded-xl border bg-card p-4 shadow-sm">
    <div className="mb-3 h-3 w-24 rounded bg-muted" />
    <div className="h-7 w-32 rounded bg-muted" />
  </div>
);

export const ProcurementOverviewScreen: FC = () => {
  const { t } = useTranslation();
  const { data, isLoading, all, year } = useProcurementOverview();
  const { data: riskBoard } = useAwarderRiskTop(
    RISK_GRADE_BOARD_PREVIEW,
    RISK_GRADE_BOARD_MIN_SCORE,
  );
  const showRiskBoard = !!riskBoard && riskBoard.rows.length > 0;
  const title =
    t("procurement_overview_title") || "Public procurement — overview";

  if (isLoading) {
    return (
      <>
        <Title description="Aggregated public-procurement contracts from data.egov.bg">
          {title}
        </Title>
        <section aria-label={title} className="my-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </section>
      </>
    );
  }

  if (!data || data.totals.contracts === 0) {
    return (
      <>
        <Title description="Aggregated public-procurement contracts from data.egov.bg">
          {title}
        </Title>
        <ProcurementSectionHeader scopeMode="toggle" />
        <section aria-label={title} className="my-4">
          <p className="mt-4 text-sm text-muted-foreground">
            {t("procurement_index_no_ns_data") ||
              "No procurement data falls within this election's date range."}
          </p>
        </section>
      </>
    );
  }

  return (
    <>
      <Title description="Aggregated public-procurement contracts from data.egov.bg">
        {title}
      </Title>
      <ProcurementSectionHeader scopeMode="toggle" />
      <section aria-label={title} className="my-4">
        <p className="mb-3 text-xs text-muted-foreground">
          {all ? (
            t("procurement_scope_all") || "Showing the full corpus, all years."
          ) : year != null ? (
            t("procurement_scope_year", { year }) ||
            `Showing contracts signed in ${year}.`
          ) : (
            <>
              {t("procurement_scope_ns") ||
                "Showing contracts during the selected parliament:"}{" "}
              <strong className="tabular-nums text-foreground">
                {data.start}
                {data.end ? ` → ${data.end}` : " → …"}
              </strong>
            </>
          )}
        </p>

        <ProcurementKpiRow />
        <div className="mt-3">
          <WatchlistDigestTile />
        </div>

        <DashboardSection
          id="procurement-money"
          title={t("procurement_section_money") || "Money flows"}
          icon={Waypoints}
          articleTopic="procurement"
        >
          <ProcurementFlowTile />
          <ProcurementSectorsTile />
        </DashboardSection>

        <DashboardSection
          id="procurement-entities"
          title={t("procurement_section_entities") || "Who wins · who awards"}
          icon={Building2}
        >
          <div className="grid gap-4 xl:grid-cols-2">
            <ProcurementTreemapTile
              entity="contractor"
              items={data.topContractors}
            />
            <ProcurementTreemapTile entity="awarder" items={data.topAwarders} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <TopContractorsTile byNs={data} />
            <TopAwardersTile data={data} />
          </div>
          <LatestContractsTile />
        </DashboardSection>

        <DashboardSection
          id="procurement-people"
          title={t("procurement_section_people") || "Politicians & connections"}
          icon={Users}
        >
          <TopConnectedPeopleTile data={data} />
        </DashboardSection>

        <DashboardSection
          id="procurement-risk"
          title={t("procurement_section_risk") || "Risk signals"}
          icon={AlertTriangle}
        >
          {showRiskBoard ? (
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="min-w-0">
                <RiskSignalsTile />
              </div>
              <div className="min-w-0">
                <RiskGradeLeaderboardTile />
              </div>
            </div>
          ) : (
            <RiskSignalsTile />
          )}
          <ProcurementBenchmarksTile />
        </DashboardSection>

        <DashboardSection
          id="procurement-tenders"
          title={t("procurement_section_tenders") || "Tenders (procedures)"}
          icon={ClipboardList}
        >
          <LatestTendersTile />
          <RecentAppealsTile />
        </DashboardSection>

        <SourceFooter t={t} />
      </section>
    </>
  );
};

const SourceFooter: FC<{ t: (k: string) => string }> = ({ t }) => (
  <p className="mt-4 text-[11px] text-muted-foreground/80">
    {t("procurement_index_source_hint") ||
      "Source: data.egov.bg (АОП OCDS, fortnightly bundles)."}{" "}
    <a
      href="https://data.egov.bg/organisation/about/aop"
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-0.5 text-primary hover:underline"
    >
      data.egov.bg <ExternalLink className="h-3 w-3" />
    </a>
  </p>
);
