import { FC } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Briefcase, Building2, Gauge, Map } from "lucide-react";
import { DashboardSectionId } from "@/data/articles/useArticles";
import { useElectionContext } from "@/data/ElectionContext";
import { useSofiaSummary } from "@/data/dashboard/useSofiaSummary";
import { useSofiaStats } from "@/data/country/useSofiaStats";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { useProblemSectionsStats } from "@/data/reports/useProblemSectionsStats";
import { SOFIA_REGIONS } from "@/data/dataTypes";
import { PartyChangeCard } from "./cards/PartyChangeCard";
import { TurnoutCard } from "./cards/TurnoutCard";
import { PaperMachineCard } from "./cards/PaperMachineCard";
import { ProblemSectionsTile } from "./ProblemSectionsTile";
import { ProblemVotesByPartyTile } from "./ProblemVotesByPartyTile";
import { HistoricalTrendsTile } from "./HistoricalTrendsTile";
import { PartyResultsTile } from "./PartyResultsTile";
import { SofiaMapTile } from "./SofiaMapTile";
import { SofiaMpsTile } from "./SofiaMpsTile";
import { MpConnectionsTile } from "./MpConnectionsTile";
import { TopSofiaAreasTile } from "./TopSofiaAreasTile";
import { TopCandidatesStrip } from "./TopCandidatesStrip";
import { FlashMemoryTile } from "./FlashMemoryTile";
import { RecountTile } from "./RecountTile";
import { SuspiciousSectionsTile } from "./SuspiciousSectionsTile";
import { DashboardSection } from "./DashboardSection";
import { SectionArticlesProvider } from "./SectionArticlesContext";

const SOFIA_BASE_PATH = "/sofia";

const SECTION_TOPICS: readonly DashboardSectionId[] = [
  "votes",
  "geography",
  "anomalies",
  "neighborhoods",
  "declarations",
];

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

export const SofiaDashboardCards: FC = () => {
  const { t } = useTranslation();
  const { electionStats } = useElectionContext();
  const { data, isLoading } = useSofiaSummary();
  const { sofiaStats } = useSofiaStats();
  const { votesSofia } = useRegionVotes();
  const { data: problemSectionsStats } = useProblemSectionsStats();
  const sofia = votesSofia();

  if (isLoading) {
    return (
      <section aria-label={t("dashboard")} className="my-4">
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] mt-3">
          <SkeletonCard className="h-[440px]" />
          <SkeletonCard className="h-[440px]" />
        </div>
      </section>
    );
  }

  if (!data) return null;

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
          <SofiaMapTile />
          <PartyResultsTile parties={data.parties} basePath={SOFIA_BASE_PATH} />
        </div>
        {electionStats?.hasPreferences ? (
          <TopCandidatesStrip
            parties={data.parties}
            regionCodes={SOFIA_REGIONS}
            basePath={SOFIA_BASE_PATH}
          />
        ) : null}
        <SofiaMpsTile parties={data.parties} />
        <HistoricalTrendsTile stats={sofiaStats} basePath={SOFIA_BASE_PATH} />
      </DashboardSection>

      <DashboardSection
        id="geography"
        title={t("dashboard_section_geography")}
        icon={Map}
        articleTopic="geography"
      >
        <TopSofiaAreasTile parties={data.parties} />
      </DashboardSection>

      <DashboardSection
        id="anomalies"
        title={t("dashboard_section_anomalies")}
        icon={AlertTriangle}
        articleTopic="anomalies"
      >
        <FlashMemoryTile
          parties={data.parties}
          results={sofia?.results}
          basePath={SOFIA_BASE_PATH}
        />
        <SuspiciousSectionsTile
          parties={data.parties}
          regionCodes={SOFIA_REGIONS}
        />
        <RecountTile
          parties={data.parties}
          results={sofia?.results}
          original={sofia?.original}
          basePath={SOFIA_BASE_PATH}
        />
      </DashboardSection>

      <DashboardSection
        id="neighborhoods"
        title={t("dashboard_section_neighborhoods")}
        icon={Building2}
        articleTopic="neighborhoods"
      >
        <ProblemSectionsTile
          parties={data.parties}
          regionCodes={SOFIA_REGIONS}
        />
        <ProblemVotesByPartyTile regionCodes={SOFIA_REGIONS} />
        {problemSectionsStats?.length ? (
          <HistoricalTrendsTile
            stats={problemSectionsStats}
            seeDetailsTo="/reports/section/problem_sections"
          />
        ) : null}
      </DashboardSection>

      <DashboardSection
        id="declarations"
        title={t("dashboard_section_declarations")}
        icon={Briefcase}
        articleTopic="declarations"
      >
        <MpConnectionsTile regionCodes={SOFIA_REGIONS} />
      </DashboardSection>
    </section>
    </SectionArticlesProvider>
  );
};
