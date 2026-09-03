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
import { ProblemSectionsTile } from "./ProblemSectionsTile";
import { ProblemVotesByPartyTile } from "./ProblemVotesByPartyTile";
import { HistoricalTrendsTile } from "./HistoricalTrendsTile";
import { TopCandidatesStrip } from "./TopCandidatesStrip";
import { TopSettlementsTile } from "./TopSettlementsTile";
import { CityRayonBreakdownTile } from "./CityRayonBreakdownTile";
import { hasCityRayons, useCityRayonHistory } from "@/data/rayon/useCityRayons";
import { findCityRayon } from "@/data/local/cityRayonCatalog";
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

/** The município page's deeper sections — everything BELOW the shared result surface.
 *
 *  ⚠ THE FOUR KPI CARDS AND THE MAP/PARTY PAIR LEFT (§4 item 3: only numbers the strip and
 *  canvas duplicate). The map's THREE-WAY BRANCH — Пловдив/Варна city's районы choropleth, a
 *  Пловдив/Варна район's own polling sections, and everything else's settlements map — moved
 *  WITH it, into `ParliamentaryMunicipalityMap`. Relocating keeps one copy; leaving a second
 *  here would diverge from it exactly on the four places nobody tests by hand.
 *
 *  ⚠ `compact` (My-Area) RENDERS THIS COMPONENT WITHOUT THE SHELL, and that is why the section
 *  keeps its `dashboard_section_votes_only` title: on that page there is no outcome strip above
 *  it, so the heading still has to be honest about what is under it. */
export const MunicipalityDashboardCards: FC<Props> = ({
  municipalityCode,
  compact,
}) => {
  const { t } = useTranslation();
  const { electionStats, priorElections } = useElectionContext();
  // A Пловдив/Варна район ("PDV22-06") isn't a real município, so several hooks
  // below must detect it and re-source its data — resolve it first.
  const cityRayon = findCityRayon(municipalityCode);
  // Multi-cycle trends for a Пловдив/Варна район: it has no `_stats.json`, so
  // useMunicipalityStats 404s → undefined, which would make HistoricalTrendsTile
  // fall back to NATIONAL trends mislabeled as район history. Feed the real
  // per-район history (client-side join over the per-election rayon JSON)
  // instead; for any normal município this is disabled and `stats` is used.
  const { data: rayonHistory } = useCityRayonHistory(
    cityRayon?.obshtina,
    cityRayon?.code,
  );
  // The summary's biggest-gainer/loser, per-party Δ and paper/machine Δ all
  // need the PRIOR election's votes. A real município gets them from its
  // `_stats.json` (useMunicipalityStats); a район has none, so pull the prior
  // cycle out of the район history above and hand it to the summary as an
  // override (same ElectionInfo shape useMunicipalityStats.prevVotes returns).
  const rayonPrevVotes = cityRayon
    ? rayonHistory?.find((h) => h.name === priorElections?.name)
    : undefined;
  const { data, isLoading } = useMunicipalitySummary(
    municipalityCode,
    rayonPrevVotes,
  );
  const { municipality } = useMunicipalityVotes(municipalityCode);
  const { stats } = useMunicipalityStats(municipalityCode);
  const { data: problemSectionsStats } = useProblemSectionsStats();
  // The neighborhoods/risk-votes section is misleading when the município
  // has no problem sections of its own — the per-município ProblemSections
  // and ProblemVotes tiles render null, but the historical-trends chart
  // beside them shows NATIONAL problem-section trends, which looks like
  // município-specific data. Detect "no problem sections here" and hide
  // the whole section to avoid the bait-and-switch. For a Пловдив/Варна район
  // the report keys sections by the parent obshtina (PDV22), so the gate below
  // matches on parent + section-code digits 5-6 — same as the tile.
  const { data: problemSectionsReport } = useProblemSections();
  const histStats = cityRayon ? rayonHistory : stats;
  const muniHasProblemSections = problemSectionsReport?.neighborhoods?.some(
    (n) =>
      n.sections.some((s) =>
        cityRayon
          ? s.obshtina === cityRayon.obshtina &&
            String(s.section).slice(4, 6) === cityRayon.code
          : s.obshtina === municipalityCode,
      ),
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
          ) : histStats?.length ? (
            <HistoricalTrendsTile stats={histStats} />
          ) : null}
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
