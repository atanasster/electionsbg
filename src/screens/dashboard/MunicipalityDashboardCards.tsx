import { FC } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Building2, Gauge, Map } from "lucide-react";
import { DashboardSectionId } from "@/data/articles/useArticles";
import { useElectionContext } from "@/data/ElectionContext";
import { useMunicipalitySummary } from "@/data/dashboard/useMunicipalitySummary";
import { useMunicipalityVotes } from "@/data/municipalities/useMunicipalityVotes";
import { useMunicipalityStats } from "@/data/municipalities/useMunicipalityStats";
import { useProblemSectionsStats } from "@/data/reports/useProblemSectionsStats";
import { useProblemSections } from "@/data/reports/useProblemSections";
import { PartyChangeCard } from "./cards/PartyChangeCard";
import { TurnoutCard } from "./cards/TurnoutCard";
import { PaperMachineCard } from "./cards/PaperMachineCard";
import { ProblemSectionsTile } from "./ProblemSectionsTile";
import { ProblemVotesByPartyTile } from "./ProblemVotesByPartyTile";
import { HistoricalTrendsTile } from "./HistoricalTrendsTile";
import { PartyResultsTile } from "./PartyResultsTile";
import { MunicipalitySettlementsMapTile } from "./MunicipalitySettlementsMapTile";
import { TopCandidatesStrip } from "./TopCandidatesStrip";
import { TopSettlementsTile } from "./TopSettlementsTile";
import { CityRayonBreakdownTile } from "./CityRayonBreakdownTile";
import { CityRayonMapTile } from "./CityRayonMapTile";
import { hasCityRayons } from "@/data/rayon/useCityRayons";
import { CensusDemographicsTile } from "./CensusDemographicsTile";
import { IndicatorsTile } from "./IndicatorsTile";
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
  municipalityCode: string;
  /** Compact mode hides election-deep-dive tiles (HistoricalTrendsTile +
   *  the whole anomalies section) and surfaces a "Full elections
   *  breakdown →" link. Used by MyAreaScreen. See the matching prop on
   *  SettlementDashboardCards for the rationale. */
  compact?: boolean;
};

export const MunicipalityDashboardCards: FC<Props> = ({
  municipalityCode,
  compact,
}) => {
  const { t } = useTranslation();
  const { electionStats } = useElectionContext();
  const { data, isLoading } = useMunicipalitySummary(municipalityCode);
  const { municipality } = useMunicipalityVotes(municipalityCode);
  const { stats } = useMunicipalityStats(municipalityCode);
  const { data: problemSectionsStats } = useProblemSectionsStats();
  // The neighborhoods/risk-votes section is misleading when the município
  // has no problem sections of its own — the per-município ProblemSections
  // and ProblemVotes tiles render null, but the historical-trends chart
  // beside them shows NATIONAL problem-section trends, which looks like
  // município-specific data. Detect "no problem sections here" and hide
  // the whole section to avoid the bait-and-switch.
  const { data: problemSectionsReport } = useProblemSections();
  const muniHasProblemSections = problemSectionsReport?.neighborhoods?.some(
    (n) => n.sections.some((s) => s.obshtina === municipalityCode),
  );

  const basePath = `/settlement/${municipalityCode}`;

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
          // On My-Area (compact) the MPs strip lives at the top of
          // MyAreaScreen as its own block — using the shorter 'Votes' /
          // 'Гласове' label keeps the section title honest about what's
          // actually rendered here (polling map + top parties only).
          title={t(
            compact
              ? "dashboard_section_votes_only"
              : "dashboard_section_votes",
          )}
          icon={Gauge}
        >
          <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            {/* Plovdiv-city / Varna-city are общини с районно деление the core
                pipeline serves as one aggregate — swap the single-blob
                settlements map for a районы choropleth, exactly like the Sofia
                МИР map. Self-applies only to those municípios. */}
            {hasCityRayons(municipalityCode) ? (
              <CityRayonMapTile municipalityCode={municipalityCode} />
            ) : (
              <MunicipalitySettlementsMapTile
                municipalityCode={municipalityCode}
              />
            )}
            <PartyResultsTile parties={data.parties} basePath={basePath} />
          </div>
          {electionStats?.hasPreferences ? (
            <TopCandidatesStrip
              parties={data.parties}
              municipalityCode={municipalityCode}
              basePath={basePath}
            />
          ) : null}
          {/* Multi-cycle time-series goes to the dedicated muni page
              in compact mode (My-Area). */}
          {compact ? (
            <a
              href={`/settlement/${municipalityCode}`}
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
          {/* For общини с районно деление the only "settlement" is the city
              itself, so the settlements list is a single useless row — show the
              ranked район breakdown (with per-party expand) instead. */}
          {hasCityRayons(municipalityCode) ? (
            <CityRayonBreakdownTile municipalityCode={municipalityCode} />
          ) : (
            <TopSettlementsTile
              parties={data.parties}
              municipalityCode={municipalityCode}
            />
          )}
          <CensusDemographicsTile
            regionCode={municipalityCode}
            isMunicipality
          />
          <IndicatorsTile obshtinaCode={municipalityCode} />
        </DashboardSection>

        {/* Anomalies section is election forensics — hidden in compact
            (My-Area) mode; the "Full elections breakdown →" link in the
            votes section above covers the click-through. */}
        {compact ? null : (
          <DashboardSection
            id="anomalies"
            title={t("dashboard_section_anomalies")}
            icon={AlertTriangle}
          >
            <FlashMemoryTile
              parties={data.parties}
              results={municipality?.results}
              basePath={basePath}
            />
            <SuspiciousSectionsTile
              parties={data.parties}
              municipalityCode={municipalityCode}
            />
            <RecountTile
              parties={data.parties}
              results={municipality?.results}
              original={municipality?.original}
              basePath={basePath}
            />
          </DashboardSection>
        )}

        {muniHasProblemSections ? (
          <DashboardSection
            id="neighborhoods"
            title={t("dashboard_section_neighborhoods")}
            icon={Building2}
          >
            <ProblemSectionsTile
              parties={data.parties}
              municipalityCode={municipalityCode}
            />
            <ProblemVotesByPartyTile municipalityCode={municipalityCode} />
            {problemSectionsStats?.length ? (
              <HistoricalTrendsTile stats={problemSectionsStats} />
            ) : null}
          </DashboardSection>
        ) : null}
      </section>
    </SectionArticlesProvider>
  );
};
