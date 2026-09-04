import { FC, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  Coins,
  Gauge,
  Map,
} from "lucide-react";
import { SkeletonSection } from "@/screens/dashboard/DashboardSkeleton";
import { useNationalSummary } from "@/data/dashboard/useNationalSummary";
import { useElectionContext } from "@/data/ElectionContext";
import { useProblemSectionsStats } from "@/data/reports/useProblemSectionsStats";
import { DashboardSectionId } from "@/data/articles/useArticles";
import { ProblemSectionsTile } from "./ProblemSectionsTile";
import { ProblemVotesByPartyTile } from "./ProblemVotesByPartyTile";
import { MandatesTile } from "./MandatesTile";
import { WastedVoteTile } from "./WastedVoteTile";
import { PersistenceTile } from "./PersistenceTile";
// Chart-heavy tiles are pulled in lazily so the recharts/d3 vendor chunk
// (~460 KB) stays off the critical path on landing. Each tile fetches its
// chunk in parallel with the page render and pops in when ready.
const HistoricalTrendsTile = lazy(() =>
  import("./HistoricalTrendsTile").then((m) => ({
    default: m.HistoricalTrendsTile,
  })),
);
const VoteFlowTile = lazy(() =>
  import("@/screens/components/voteFlow/VoteFlowTile").then((m) => ({
    default: m.VoteFlowTile,
  })),
);
import { TopCandidatesStrip } from "./TopCandidatesStrip";
import { TopRegionsTile } from "./TopRegionsTile";
import { DemographicCleavagesTile } from "./DemographicCleavagesTile";
import { TopLocationsTile } from "./TopLocationsTile";
import { TopFinancingTile } from "./TopFinancingTile";
import { FlashMemoryTile } from "./FlashMemoryTile";
import { RecountTile } from "./RecountTile";
import { SuspiciousSectionsTile } from "./SuspiciousSectionsTile";
import { BenfordTile } from "./BenfordTile";
import { RiskScoreTile } from "./RiskScoreTile";
import { CompositeIndexRibbon } from "@/screens/components/riskAnalysis/CompositeIndexRibbon";
import { PollsTile } from "./PollsTile";
const AccuracyTrendsTile = lazy(() =>
  import("./AccuracyTrendsTile").then((m) => ({
    default: m.AccuracyTrendsTile,
  })),
);
import { ArticlesTile } from "./ArticlesTile";
import { DashboardSection } from "./DashboardSection";
import { orderSections } from "./sectionOrder";
import { SectionArticlesProvider } from "./SectionArticlesContext";

/** ⚠ WHICH topics, not what ORDER — the sequence comes from `orderSections` so this list
 *  and the `<DashboardSection>` elements below cannot drift apart. They are two independent
 *  orderings in one file, times seven files, and nothing compared any of them until
 *  §Phase 7 item 4. */
const SECTION_TOPICS: readonly DashboardSectionId[] = orderSections([
  "votes",
  "geography",
  "anomalies",
  "neighborhoods",
  "financing",
  "polling",
]);

/** The country page's deeper sections — everything BELOW the shared result surface.
 *
 *  ⚠ WHAT LEFT, AND WHAT DELIBERATELY DID NOT (§4 item 3: "remove only numbers duplicated by
 *  the new strip/canvas"). The four KPI cards left because the outcome strip states the same
 *  four facts — winner, margin, turnout, paper/machine — and the map beside the party result
 *  left because that pair IS the outcome canvas. Everything else stays exactly where it was:
 *  mandates, top candidates, wasted vote, persistence, the vote flow, the trends, and every
 *  section below. A migration that also tidied would be impossible to review against the page
 *  it replaced.
 *
 *  ⚠ `data-og="parliamentary-result"` MOVED WITH THE MAP, to the shell's canvas. It is the
 *  /parliamentary card's clip anchor, and the capture waits on a map PATH rather than on the
 *  element — both tiles render a lucide icon, itself an `<svg>`, at mount. */
export const DashboardCards: FC = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useNationalSummary();
  const { electionStats } = useElectionContext();
  const { data: problemSectionsStats } = useProblemSectionsStats();

  // electionStats is derived synchronously from in-memory data, so we use it
  // to gate the same set of optional rows in both the skeleton and live
  // branches. Otherwise the skeleton would show rows for data that won't
  // appear, or vice versa.
  const hasFinancials = !!electionStats?.hasFinancials;
  const hasRecount = !!electionStats?.hasRecount;
  const hasFlash = !!electionStats?.hasSuemg;

  if (isLoading || !data) {
    if (!isLoading && !data) return null;
    return (
      <section aria-label={t("dashboard")} className="my-4">
        {/* ⚠ NO KPI SKELETON ROW ANY MORE. The four cards it stood in for moved to the shared
            outcome strip, which reserves its own space through `ElectionSurfaceSkeleton` — a
            second row of four here would reserve height that nothing ever fills, which is the
            same layout shift in the other direction. */}
        <SkeletonSection rows={2} />
        <SkeletonSection rows={2} />
        {hasFlash || hasRecount ? <SkeletonSection rows={2} /> : null}
        <SkeletonSection rows={2} />
        {hasFinancials ? <SkeletonSection rows={1} /> : null}
        <SkeletonSection rows={2} />
      </section>
    );
  }

  const hasTopLocations =
    !!data.topDiaspora?.length || !!data.topCities?.length;

  return (
    <SectionArticlesProvider order={SECTION_TOPICS}>
      <section aria-label={t("dashboard")} className="my-4">
        <DashboardSection
          id="votes"
          title={t("dashboard_section_votes")}
          icon={Gauge}
          articleTopic="votes"
        >
          <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <MandatesTile parties={data.parties} />
            <TopCandidatesStrip parties={data.parties} />
          </div>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            <WastedVoteTile />
            <PersistenceTile />
          </div>
          <Suspense fallback={null}>
            <VoteFlowTile />
            <HistoricalTrendsTile />
          </Suspense>
        </DashboardSection>

        <DashboardSection
          id="geography"
          title={t("dashboard_section_geography")}
          icon={Map}
          articleTopic="geography"
        >
          <TopRegionsTile parties={data.parties} />
          <DemographicCleavagesTile />
          {hasTopLocations ? (
            <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
              {data.topDiaspora?.length ? (
                <TopLocationsTile variant="diaspora" items={data.topDiaspora} />
              ) : null}
              {data.topCities?.length ? (
                <TopLocationsTile variant="cities" items={data.topCities} />
              ) : null}
            </div>
          ) : null}
        </DashboardSection>

        <DashboardSection
          id="polling"
          title={t("dashboard_section_polling")}
          icon={CalendarDays}
          articleTopic="polling"
        >
          <PollsTile />
          <Suspense fallback={null}>
            <AccuracyTrendsTile />
          </Suspense>
        </DashboardSection>

        <DashboardSection
          id="financing"
          title={t("dashboard_section_financing")}
          icon={Coins}
          articleTopic="financing"
        >
          <TopFinancingTile parties={data.parties} />
        </DashboardSection>

        {hasFinancials ? (
          <DashboardSection
            id="anomalies"
            title={t("dashboard_section_anomalies")}
            icon={AlertTriangle}
            articleTopic="anomalies"
          >
            <CompositeIndexRibbon />
            {hasFlash ? <FlashMemoryTile parties={data.parties} /> : null}
            <SuspiciousSectionsTile parties={data.parties} />
            <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
              <RiskScoreTile />
              <BenfordTile />
            </div>
            {hasRecount ? <RecountTile parties={data.parties} /> : null}
          </DashboardSection>
        ) : null}

        <DashboardSection
          id="neighborhoods"
          title={t("dashboard_section_neighborhoods")}
          icon={Building2}
          articleTopic="neighborhoods"
        >
          <ProblemSectionsTile parties={data.parties} />
          <ProblemVotesByPartyTile />
          {problemSectionsStats?.length ? (
            <Suspense fallback={null}>
              <HistoricalTrendsTile stats={problemSectionsStats} />
            </Suspense>
          ) : null}
        </DashboardSection>

        <div className="mt-6">
          <ArticlesTile shownTopics={SECTION_TOPICS} />
        </div>
      </section>
    </SectionArticlesProvider>
  );
};
