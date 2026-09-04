import { FC } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Gauge } from "lucide-react";
import { DashboardSectionId } from "@/data/articles/useArticles";
import { useSectionSummary } from "@/data/dashboard/useSectionSummary";
import { useSectionsVotes } from "@/data/sections/useSectionsVotes";
import { useSectionStats } from "@/data/sections/useSectionStats";
import { HistoricalTrendsTile } from "./HistoricalTrendsTile";
import { FlashMemoryTile } from "./FlashMemoryTile";
import { RecountTile } from "./RecountTile";
import { SectionRiskTile } from "./SectionRiskTile";
import { SectionRiskHistoryTile } from "./cards/SectionRiskHistoryTile";
import { DashboardSection } from "./DashboardSection";
import { orderSections } from "./sectionOrder";
import { SectionArticlesProvider } from "./SectionArticlesContext";

/** ⚠ WHICH topics, not what ORDER — the sequence comes from `orderSections` so this list
 *  and the `<DashboardSection>` elements below cannot drift apart. They are two independent
 *  orderings in one file, times seven files, and nothing compared any of them until
 *  §Phase 7 item 4. */
const SECTION_TOPICS: readonly DashboardSectionId[] = orderSections([
  "votes",
  "anomalies",
]);

const SkeletonCard: FC<{ className?: string }> = ({
  className = "h-[140px]",
}) => (
  <div
    className={`rounded-xl border bg-card p-4 shadow-sm animate-pulse ${className}`}
  >
    <div className="h-3 w-24 bg-muted rounded mb-3" />
    <div className="h-7 w-32 bg-muted rounded" />
  </div>
);

type Props = {
  sectionCode: string;
};

/** One polling station's deeper sections — everything BELOW the shared result surface.
 *
 *  ⚠ THE FOUR KPI CARDS AND THE RANKED PARTY TILE LEFT (§4 item 3), and NO MAP left with them
 *  because this page never had one: a single polling station has no geography to answer a
 *  question about, its descriptor declares `maps: []`, and §Phase 6 item 3 makes that a rule
 *  rather than an accident. The trends chart STAYS — a station's turnout and party history
 *  across cycles is substantive, not decorative, and nothing in the plan asks for it to go.
 *
 *  ⚠ AND NO DIGEST ON THIS LEVEL (item 5b). Three of the four views do not resolve at a polling
 *  station, so a one-cell digest is chrome — `buildPlaceDigest` refuses a section outright
 *  rather than leaving the floor to do it arithmetically. */
export const SectionDashboardCards: FC<Props> = ({ sectionCode }) => {
  const { t } = useTranslation();
  const { data, isLoading } = useSectionSummary(sectionCode);
  const section = useSectionsVotes(sectionCode);
  const { stats } = useSectionStats(sectionCode);

  const basePath = `/section/${sectionCode}`;

  if (isLoading) {
    return (
      <section aria-label={t("dashboard")} className="my-4">
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard className="h-[440px]" />
        </div>
      </section>
    );
  }

  if (!data) return null;

  return (
    <SectionArticlesProvider order={SECTION_TOPICS}>
      <section aria-label={t("dashboard")} className="my-4">
        <DashboardSection
          id="votes"
          title={t("dashboard_section_votes")}
          icon={Gauge}
        >
          <HistoricalTrendsTile stats={stats} />
        </DashboardSection>

        <DashboardSection
          id="anomalies"
          title={t("dashboard_section_anomalies")}
          icon={AlertTriangle}
        >
          <FlashMemoryTile
            parties={data.parties}
            results={section?.results}
            basePath={basePath}
          />
          <RecountTile
            parties={data.parties}
            results={section?.results}
            original={section?.original}
            basePath={basePath}
          />
          <SectionRiskTile sectionCode={sectionCode} />
          <SectionRiskHistoryTile sectionCode={sectionCode} />
        </DashboardSection>
      </section>
    </SectionArticlesProvider>
  );
};
