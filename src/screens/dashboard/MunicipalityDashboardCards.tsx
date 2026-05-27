import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Building2,
  Coins,
  Gauge,
  Landmark,
  Map,
} from "lucide-react";
import { DashboardSectionId } from "@/data/articles/useArticles";
import { useElectionContext } from "@/data/ElectionContext";
import { useMunicipalitySummary } from "@/data/dashboard/useMunicipalitySummary";
import { useMunicipalityVotes } from "@/data/municipalities/useMunicipalityVotes";
import { useMunicipalityStats } from "@/data/municipalities/useMunicipalityStats";
import { useProblemSectionsStats } from "@/data/reports/useProblemSectionsStats";
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
import { CensusDemographicsTile } from "./CensusDemographicsTile";
import { IndicatorsTile } from "./IndicatorsTile";
import { MunicipalityTransfersTile } from "./MunicipalityTransfersTile";
import { EuFundsTile } from "./EuFundsTile";
import { SofiaCapitalProjectsTile } from "./SofiaCapitalProjectsTile";
import { PlovdivCapitalProjectsTile } from "./PlovdivCapitalProjectsTile";
import { VarnaCapitalProjectsTile } from "./VarnaCapitalProjectsTile";
import { BurgasCapitalProjectsTile } from "./BurgasCapitalProjectsTile";
import { StaraZagoraCapitalProjectsTile } from "./StaraZagoraCapitalProjectsTile";
import { RuseCapitalProjectsTile } from "./RuseCapitalProjectsTile";
import { PlevenCapitalProjectsTile } from "./PlevenCapitalProjectsTile";
import { SlivenCapitalProjectsTile } from "./SlivenCapitalProjectsTile";
import { DobrichCapitalProjectsTile } from "./DobrichCapitalProjectsTile";
import { AsenovgradCapitalProjectsTile } from "./AsenovgradCapitalProjectsTile";
import { ShumenCapitalProjectsTile } from "./ShumenCapitalProjectsTile";
import { VidinCapitalProjectsTile } from "./VidinCapitalProjectsTile";
import { VelikoTarnovoCapitalProjectsTile } from "./VelikoTarnovoCapitalProjectsTile";
import { PernikCapitalProjectsTile } from "./PernikCapitalProjectsTile";
import { HaskovoCapitalProjectsTile } from "./HaskovoCapitalProjectsTile";
import { GabrovoCapitalProjectsTile } from "./GabrovoCapitalProjectsTile";
import { YambolCapitalProjectsTile } from "./YambolCapitalProjectsTile";
import { KardzhaliCapitalProjectsTile } from "./KardzhaliCapitalProjectsTile";
import { LovechCapitalProjectsTile } from "./LovechCapitalProjectsTile";
import { DupnitsaCapitalProjectsTile } from "./DupnitsaCapitalProjectsTile";
import { VelingradCapitalProjectsTile } from "./VelingradCapitalProjectsTile";
import { SamokovCapitalProjectsTile } from "./SamokovCapitalProjectsTile";
import { KarlovoCapitalProjectsTile } from "./KarlovoCapitalProjectsTile";
import { FlashMemoryTile } from "./FlashMemoryTile";
import { RecountTile } from "./RecountTile";
import { SuspiciousSectionsTile } from "./SuspiciousSectionsTile";
import { MunicipalMayorTile } from "./MunicipalMayorTile";
import { MunicipalCouncilCompositionTile } from "./MunicipalCouncilCompositionTile";
import { MunicipalOfficialsRosterTile } from "./MunicipalOfficialsRosterTile";
import { DashboardSection } from "./DashboardSection";
import { SectionArticlesProvider } from "./SectionArticlesContext";

const SECTION_TOPICS: readonly DashboardSectionId[] = [
  "votes",
  "geography",
  "local_government",
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
};

export const MunicipalityDashboardCards: FC<Props> = ({ municipalityCode }) => {
  const { t } = useTranslation();
  const { electionStats } = useElectionContext();
  const { data, isLoading } = useMunicipalitySummary(municipalityCode);
  const { municipality } = useMunicipalityVotes(municipalityCode);
  const { stats } = useMunicipalityStats(municipalityCode);
  const { data: problemSectionsStats } = useProblemSectionsStats();

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
          title={t("dashboard_section_votes")}
          icon={Gauge}
        >
          <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <MunicipalitySettlementsMapTile
              municipalityCode={municipalityCode}
            />
            <PartyResultsTile parties={data.parties} basePath={basePath} />
          </div>
          {electionStats?.hasPreferences ? (
            <TopCandidatesStrip
              parties={data.parties}
              municipalityCode={municipalityCode}
              basePath={basePath}
            />
          ) : null}
          <HistoricalTrendsTile stats={stats} />
        </DashboardSection>

        <DashboardSection
          id="geography"
          title={t("dashboard_section_geography")}
          icon={Map}
        >
          <TopSettlementsTile
            parties={data.parties}
            municipalityCode={municipalityCode}
          />
          <CensusDemographicsTile
            regionCode={municipalityCode}
            isMunicipality
          />
          <IndicatorsTile obshtinaCode={municipalityCode} />
        </DashboardSection>

        <DashboardSection
          id="local_government"
          title={t("dashboard_section_local_government")}
          icon={Landmark}
        >
          <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
            <MunicipalMayorTile obshtinaCode={municipalityCode} />
            <MunicipalCouncilCompositionTile obshtinaCode={municipalityCode} />
          </div>
          <MunicipalOfficialsRosterTile obshtinaCode={municipalityCode} />
        </DashboardSection>

        <DashboardSection
          id="finances"
          title={t("dashboard_section_finances")}
          icon={Coins}
        >
          <MunicipalityTransfersTile municipalityCode={municipalityCode} />
          <EuFundsTile kind="muni" obshtina={municipalityCode} />
          <SofiaCapitalProjectsTile obshtinaCode={municipalityCode} />
          <PlovdivCapitalProjectsTile obshtinaCode={municipalityCode} />
          <VarnaCapitalProjectsTile obshtinaCode={municipalityCode} />
          <BurgasCapitalProjectsTile obshtinaCode={municipalityCode} />
          <StaraZagoraCapitalProjectsTile obshtinaCode={municipalityCode} />
          <RuseCapitalProjectsTile obshtinaCode={municipalityCode} />
          <PlevenCapitalProjectsTile obshtinaCode={municipalityCode} />
          <SlivenCapitalProjectsTile obshtinaCode={municipalityCode} />
          <DobrichCapitalProjectsTile obshtinaCode={municipalityCode} />
          <AsenovgradCapitalProjectsTile obshtinaCode={municipalityCode} />
          <ShumenCapitalProjectsTile obshtinaCode={municipalityCode} />
          <VidinCapitalProjectsTile obshtinaCode={municipalityCode} />
          <VelikoTarnovoCapitalProjectsTile obshtinaCode={municipalityCode} />
          <PernikCapitalProjectsTile obshtinaCode={municipalityCode} />
          <HaskovoCapitalProjectsTile obshtinaCode={municipalityCode} />
          <GabrovoCapitalProjectsTile obshtinaCode={municipalityCode} />
          <YambolCapitalProjectsTile obshtinaCode={municipalityCode} />
          <KardzhaliCapitalProjectsTile obshtinaCode={municipalityCode} />
          <LovechCapitalProjectsTile obshtinaCode={municipalityCode} />
          <DupnitsaCapitalProjectsTile obshtinaCode={municipalityCode} />
          <VelingradCapitalProjectsTile obshtinaCode={municipalityCode} />
          <SamokovCapitalProjectsTile obshtinaCode={municipalityCode} />
          <KarlovoCapitalProjectsTile obshtinaCode={municipalityCode} />
        </DashboardSection>

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
      </section>
    </SectionArticlesProvider>
  );
};
