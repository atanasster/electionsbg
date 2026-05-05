import { FC } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Briefcase, Building2, Gauge, Map } from "lucide-react";
import { DashboardSectionId } from "@/data/articles/useArticles";
import { useElectionContext } from "@/data/ElectionContext";
import { useRegionSummary } from "@/data/dashboard/useRegionSummary";
import { useProblemSectionsStats } from "@/data/reports/useProblemSectionsStats";
import { PartyChangeCard } from "./cards/PartyChangeCard";
import { TurnoutCard } from "./cards/TurnoutCard";
import { PaperMachineCard } from "./cards/PaperMachineCard";
import { ProblemSectionsTile } from "./ProblemSectionsTile";
import { ProblemVotesByPartyTile } from "./ProblemVotesByPartyTile";
import { HistoricalTrendsTile } from "./HistoricalTrendsTile";
import { PartyResultsTile } from "./PartyResultsTile";
import { RegionMpsTile } from "./RegionMpsTile";
import { MpConnectionsTile } from "./MpConnectionsTile";
import { RegionMunicipalitiesMapTile } from "./RegionMunicipalitiesMapTile";
import { TopCandidatesStrip } from "./TopCandidatesStrip";
import { TopMunicipalitiesTile } from "./TopMunicipalitiesTile";
import { FlashMemoryTile } from "./FlashMemoryTile";
import { RecountTile } from "./RecountTile";
import { SuspiciousSectionsTile } from "./SuspiciousSectionsTile";
import { DashboardSection } from "./DashboardSection";
import { SectionArticlesProvider } from "./SectionArticlesContext";

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

type Props = {
  regionCode: string;
};

export const RegionDashboardCards: FC<Props> = ({ regionCode }) => {
  const { t } = useTranslation();
  const { electionStats } = useElectionContext();
  const { data, isLoading } = useRegionSummary(regionCode);
  const { data: problemSectionsStats } = useProblemSectionsStats();

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
          <RegionMunicipalitiesMapTile regionCode={regionCode} />
          <PartyResultsTile parties={data.parties} regionCode={regionCode} />
        </div>
        {electionStats?.hasPreferences ? (
          <TopCandidatesStrip parties={data.parties} regionCode={regionCode} />
        ) : null}
        <RegionMpsTile regionCode={regionCode} parties={data.parties} />
        <HistoricalTrendsTile regionCode={regionCode} />
      </DashboardSection>

      <DashboardSection
        id="geography"
        title={t("dashboard_section_geography")}
        icon={Map}
        articleTopic="geography"
      >
        <TopMunicipalitiesTile parties={data.parties} regionCode={regionCode} />
      </DashboardSection>

      <DashboardSection
        id="anomalies"
        title={t("dashboard_section_anomalies")}
        icon={AlertTriangle}
        articleTopic="anomalies"
      >
        <FlashMemoryTile parties={data.parties} regionCode={regionCode} />
        <SuspiciousSectionsTile
          parties={data.parties}
          regionCode={regionCode}
        />
        <RecountTile parties={data.parties} regionCode={regionCode} />
      </DashboardSection>

      <DashboardSection
        id="neighborhoods"
        title={t("dashboard_section_neighborhoods")}
        icon={Building2}
        articleTopic="neighborhoods"
      >
        <ProblemSectionsTile parties={data.parties} regionCode={regionCode} />
        <ProblemVotesByPartyTile regionCode={regionCode} />
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
        <MpConnectionsTile regionCode={regionCode} />
      </DashboardSection>
    </section>
    </SectionArticlesProvider>
  );
};
