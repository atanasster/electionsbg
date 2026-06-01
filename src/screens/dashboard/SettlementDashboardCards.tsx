import { FC } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Building2, Gauge, Map } from "lucide-react";
import { DashboardSectionId } from "@/data/articles/useArticles";
import { useElectionContext } from "@/data/ElectionContext";
import { useSettlementSummary } from "@/data/dashboard/useSettlementSummary";
import { useSettlementVotes } from "@/data/settlements/useSettlementVotes";
import { useSettlementStats } from "@/data/settlements/useSettlementStats";
import { useProblemSectionsStats } from "@/data/reports/useProblemSectionsStats";
import { useProblemSections } from "@/data/reports/useProblemSections";
import { PartyChangeCard } from "./cards/PartyChangeCard";
import { TurnoutCard } from "./cards/TurnoutCard";
import { PaperMachineCard } from "./cards/PaperMachineCard";
import { ProblemSectionsTile } from "./ProblemSectionsTile";
import { ProblemVotesByPartyTile } from "./ProblemVotesByPartyTile";
import { HistoricalTrendsTile } from "./HistoricalTrendsTile";
import { PartyResultsTile } from "./PartyResultsTile";
import { SectionsMapTile } from "./SectionsMapTile";
import { TopSectionsTile } from "./TopSectionsTile";
import { CensusDemographicsTile } from "./CensusDemographicsTile";
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
  /** Compact mode hides election-deep-dive tiles (HistoricalTrendsTile +
   *  the whole anomalies section: FlashMemory / SuspiciousSections /
   *  Recount) and surfaces a "See full elections breakdown →" link to
   *  the dedicated /sections/<ekatte> page. Used by MyAreaScreen — the
   *  My-Area dashboard is the civic-engagement landing, not the
   *  election forensic deep-dive. */
  compact?: boolean;
};

export const SettlementDashboardCards: FC<Props> = ({ ekatte, compact }) => {
  const { t } = useTranslation();
  const { electionStats } = useElectionContext();
  const { data, isLoading } = useSettlementSummary(ekatte);
  const { settlement } = useSettlementVotes(ekatte);
  const { stats } = useSettlementStats(ekatte);
  const { data: problemSectionsStats } = useProblemSectionsStats();
  // Hide the whole neighborhoods/risk-votes section when this settlement
  // has no problem sections of its own — mirrors the município-level
  // fix to stop the national HistoricalTrendsTile from being shown next
  // to two empty per-settlement tiles, which read as "this settlement's
  // risk votes" but is actually national data.
  const { data: problemSectionsReport } = useProblemSections();
  const settlementHasProblemSections =
    problemSectionsReport?.neighborhoods?.some((n) =>
      n.sections.some((s) => s.ekatte === ekatte),
    );

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
          // On My-Area (compact) we render only the polling-sections map
          // + top parties here; the MPs strip lives at the top of
          // MyAreaScreen as its own block. The default title 'Votes & MPs'
          // would mis-describe what's actually in this section. Use the
          // shorter 'Votes' / 'Гласове' label in that mode.
          title={t(
            compact
              ? "dashboard_section_votes_only"
              : "dashboard_section_votes",
          )}
          icon={Gauge}
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
          {/* Multi-cycle time-series belongs on the dedicated election
              page — in compact mode (My-Area) we surface a link instead. */}
          {compact ? (
            <a
              href={`/sections/${ekatte}`}
              className="text-xs text-primary underline self-start"
            >
              {t("my_area_full_election_breakdown_link")}
            </a>
          ) : (
            <HistoricalTrendsTile stats={stats} />
          )}
        </DashboardSection>

        <DashboardSection
          id="geography"
          title={t("dashboard_section_geography")}
          icon={Map}
        >
          <TopSectionsTile ekatte={ekatte} sections={settlement?.sections} />
          <CensusDemographicsTile
            regionCode={ekatte}
            isSettlement
            // The ГРАО registered-population block is surfaced at the
            // top of MyAreaScreen (in PlaceHeader) when in compact mode,
            // so suppress the duplicate here.
            hideGrao={compact}
          />
        </DashboardSection>

        {/* Anomalies section (FlashMemory / Suspicious / Recount) is
            election forensics — power-user material that belongs on the
            dedicated settlement page, not the My-Area civic landing.
            Compact mode skips it; the "Full elections breakdown →" link
            inside the votes section covers the click-through. */}
        {compact ? null : (
          <DashboardSection
            id="anomalies"
            title={t("dashboard_section_anomalies")}
            icon={AlertTriangle}
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
        )}

        {settlementHasProblemSections ? (
          <DashboardSection
            id="neighborhoods"
            title={t("dashboard_section_neighborhoods")}
            icon={Building2}
          >
            <ProblemSectionsTile parties={data.parties} ekatte={ekatte} />
            <ProblemVotesByPartyTile ekatte={ekatte} />
            {problemSectionsStats?.length ? (
              <HistoricalTrendsTile stats={problemSectionsStats} />
            ) : null}
          </DashboardSection>
        ) : null}
      </section>
    </SectionArticlesProvider>
  );
};
