import { FC } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Building2, Gauge, Map } from "lucide-react";
import { DashboardSectionId } from "@/data/articles/useArticles";
import { useElectionContext } from "@/data/ElectionContext";
import { useSettlementSummary } from "@/data/dashboard/useSettlementSummary";
import { useSettlementVotes } from "@/data/settlements/useSettlementVotes";
import { useSettlementStats } from "@/data/settlements/useSettlementStats";
import { useProblemSectionsStats } from "@/data/reports/useProblemSectionsStats";
import { PartyChangeCard } from "./cards/PartyChangeCard";
import { TurnoutCard } from "./cards/TurnoutCard";
import { PaperMachineCard } from "./cards/PaperMachineCard";
import { ProblemSectionsTile } from "./ProblemSectionsTile";
import { ProblemVotesByPartyTile } from "./ProblemVotesByPartyTile";
import { HistoricalTrendsTile } from "./HistoricalTrendsTile";
import { PartyResultsTile } from "./PartyResultsTile";
import { SectionsMapTile } from "./SectionsMapTile";
import { TopSectionsTile } from "./TopSectionsTile";
import { TopCandidatesStrip } from "./TopCandidatesStrip";
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
  ekatte: string;
};

export const SettlementDashboardCards: FC<Props> = ({ ekatte }) => {
  const { t } = useTranslation();
  const { electionStats } = useElectionContext();
  const { data, isLoading } = useSettlementSummary(ekatte);
  const { settlement } = useSettlementVotes(ekatte);
  const { stats } = useSettlementStats(ekatte);
  const { data: problemSectionsStats } = useProblemSectionsStats();

  const basePath = `/sections/${ekatte}`;

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
            <SectionsMapTile ekatte={ekatte} />
            <PartyResultsTile parties={data.parties} basePath={basePath} />
          </div>
          {electionStats?.hasPreferences ? (
            <TopCandidatesStrip
              parties={data.parties}
              ekatte={ekatte}
              basePath={basePath}
            />
          ) : null}
          <HistoricalTrendsTile stats={stats} basePath={basePath} />
        </DashboardSection>

        <DashboardSection
          id="geography"
          title={t("dashboard_section_geography")}
          icon={Map}
          articleTopic="geography"
        >
          <TopSectionsTile ekatte={ekatte} sections={settlement?.sections} />
        </DashboardSection>

        <DashboardSection
          id="anomalies"
          title={t("dashboard_section_anomalies")}
          icon={AlertTriangle}
          articleTopic="anomalies"
        >
          <FlashMemoryTile
            parties={data.parties}
            results={settlement?.results}
            basePath={basePath}
          />
          <SuspiciousSectionsTile parties={data.parties} ekatte={ekatte} />
          <RecountTile
            parties={data.parties}
            results={settlement?.results}
            original={settlement?.original}
            basePath={basePath}
          />
        </DashboardSection>

        <DashboardSection
          id="neighborhoods"
          title={t("dashboard_section_neighborhoods")}
          icon={Building2}
          articleTopic="neighborhoods"
        >
          <ProblemSectionsTile parties={data.parties} ekatte={ekatte} />
          <ProblemVotesByPartyTile ekatte={ekatte} />
          {problemSectionsStats?.length ? (
            <HistoricalTrendsTile
              stats={problemSectionsStats}
              seeDetailsTo="/reports/section/problem_sections"
            />
          ) : null}
        </DashboardSection>
      </section>
    </SectionArticlesProvider>
  );
};
