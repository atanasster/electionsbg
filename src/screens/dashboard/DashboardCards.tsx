import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Briefcase,
  Building2,
  CalendarDays,
  Coins,
  Gauge,
  Map,
} from "lucide-react";
import { useNationalSummary } from "@/data/dashboard/useNationalSummary";
import { useElectionContext } from "@/data/ElectionContext";
import { useProblemSectionsStats } from "@/data/reports/useProblemSectionsStats";
import { DashboardSectionId } from "@/data/articles/useArticles";
import { PartyChangeCard } from "./cards/PartyChangeCard";
import { TurnoutCard } from "./cards/TurnoutCard";
import { PaperMachineCard } from "./cards/PaperMachineCard";
import { ProblemSectionsTile } from "./ProblemSectionsTile";
import { ProblemVotesByPartyTile } from "./ProblemVotesByPartyTile";
import { MandatesTile } from "./MandatesTile";
import { HistoricalTrendsTile } from "./HistoricalTrendsTile";
import { PartyResultsTile } from "./PartyResultsTile";
import { RegionsMapTile } from "./RegionsMapTile";
import { TopCandidatesStrip } from "./TopCandidatesStrip";
import { TopRegionsTile } from "./TopRegionsTile";
import { TopLocationsTile } from "./TopLocationsTile";
import { TopFinancingTile } from "./TopFinancingTile";
import { FlashMemoryTile } from "./FlashMemoryTile";
import { RecountTile } from "./RecountTile";
import { SuspiciousSectionsTile } from "./SuspiciousSectionsTile";
import { PollsTile } from "./PollsTile";
import { AccuracyTrendsTile } from "./AccuracyTrendsTile";
import { ArticlesTile } from "./ArticlesTile";
import { MpConnectionsTile } from "./MpConnectionsTile";
import { CarMakesTile } from "./CarMakesTile";
import { MpAssetsTile } from "./MpAssetsTile";
import { DashboardSection } from "./DashboardSection";
import { MpDeclarationsProvenance } from "./MpDeclarationsProvenance";
import { SectionArticlesProvider } from "./SectionArticlesContext";

const SECTION_TOPICS: readonly DashboardSectionId[] = [
  "votes",
  "geography",
  "anomalies",
  "neighborhoods",
  "financing",
  "declarations",
  "polling",
];

const SkeletonCard: FC<{ className?: string }> = ({
  className = "h-[160px]",
}) => (
  <div
    className={`rounded-xl border bg-card p-4 shadow-sm animate-pulse ${className}`}
  >
    <div className="h-3 w-24 bg-muted rounded mb-3" />
    <div className="h-7 w-32 bg-muted rounded" />
  </div>
);

const SkeletonSection: FC<{ rows?: number }> = ({ rows = 1 }) => (
  <section className="mt-8 first:mt-2">
    <div className="h-3 w-32 bg-muted rounded mb-4 animate-pulse" />
    <div className="flex flex-col gap-4">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  </section>
);

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
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <SkeletonSection rows={2} />
        <SkeletonSection rows={2} />
        {hasFlash || hasRecount ? <SkeletonSection rows={2} /> : null}
        <SkeletonSection rows={2} />
        <SkeletonSection rows={2} />
        {hasFinancials ? <SkeletonSection rows={1} /> : null}
        <SkeletonSection rows={1} />
        <SkeletonSection rows={2} />
      </section>
    );
  }

  const hasTopLocations =
    !!data.topDiaspora?.length || !!data.topCities?.length;

  return (
    <SectionArticlesProvider order={SECTION_TOPICS}>
    <section aria-label={t("dashboard")} className="my-4">
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <PartyChangeCard variant="gainer" change={data.topGainer} />
        <PartyChangeCard variant="loser" change={data.topLoser} />
        <TurnoutCard
          turnout={data.turnout}
          priorElection={data.priorElection}
        />
        <PaperMachineCard
          paperMachine={data.paperMachine}
          priorElection={data.priorElection}
        />
      </div>

      <DashboardSection
        id="votes"
        title={t("dashboard_section_votes")}
        icon={Gauge}
        articleTopic="votes"
      >
        <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <RegionsMapTile />
          <PartyResultsTile parties={data.parties} />
        </div>
        <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <MandatesTile parties={data.parties} />
          <TopCandidatesStrip parties={data.parties} />
        </div>
        <HistoricalTrendsTile />
      </DashboardSection>

      <DashboardSection
        id="geography"
        title={t("dashboard_section_geography")}
        icon={Map}
        articleTopic="geography"
      >
        <TopRegionsTile parties={data.parties} />
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
        id="anomalies"
        title={t("dashboard_section_anomalies")}
        icon={AlertTriangle}
        articleTopic="anomalies"
      >
        {hasFlash ? <FlashMemoryTile parties={data.parties} /> : null}
        <SuspiciousSectionsTile parties={data.parties} />
        {hasRecount ? <RecountTile parties={data.parties} /> : null}
      </DashboardSection>

      <DashboardSection
        id="neighborhoods"
        title={t("dashboard_section_neighborhoods")}
        icon={Building2}
        articleTopic="neighborhoods"
      >
        <ProblemSectionsTile parties={data.parties} />
        <ProblemVotesByPartyTile />
        {problemSectionsStats?.length ? (
          <HistoricalTrendsTile
            stats={problemSectionsStats}
            seeDetailsTo="/reports/section/problem_sections"
          />
        ) : null}
      </DashboardSection>

      {hasFinancials ? (
        <DashboardSection
          id="financing"
          title={t("dashboard_section_financing")}
          icon={Coins}
          articleTopic="financing"
        >
          <TopFinancingTile parties={data.parties} />
        </DashboardSection>
      ) : null}

      <DashboardSection
        id="declarations"
        title={t("dashboard_section_declarations")}
        subtitle={<MpDeclarationsProvenance />}
        icon={Briefcase}
        articleTopic="declarations"
      >
        <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
          <MpConnectionsTile hideProvenance />
          <CarMakesTile hideProvenance />
        </div>
        <MpAssetsTile />
      </DashboardSection>

      <DashboardSection
        id="polling"
        title={t("dashboard_section_polling")}
        icon={CalendarDays}
        articleTopic="polling"
      >
        <PollsTile />
        <AccuracyTrendsTile />
      </DashboardSection>

      <div className="mt-6">
        <ArticlesTile shownTopics={SECTION_TOPICS} />
      </div>
    </section>
    </SectionArticlesProvider>
  );
};
