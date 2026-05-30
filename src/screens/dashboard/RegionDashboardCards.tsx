import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Briefcase,
  Building2,
  Gauge,
  HelpCircle,
  Landmark,
  Map,
} from "lucide-react";
import { useElectionContext } from "@/data/ElectionContext";
import { useRegionSummary } from "@/data/dashboard/useRegionSummary";
import { useProblemSectionsStats } from "@/data/reports/useProblemSectionsStats";
import { useRegionDeclarationsHasContent } from "@/data/parliament/useMpDeclarationsAvailability";
import { SOFIA_REGIONS } from "@/data/dataTypes";
import { PartyChangeCard } from "./cards/PartyChangeCard";
import { TurnoutCard } from "./cards/TurnoutCard";
import { PaperMachineCard } from "./cards/PaperMachineCard";
import { ProblemSectionsTile } from "./ProblemSectionsTile";
import { ProblemVotesByPartyTile } from "./ProblemVotesByPartyTile";
import { HistoricalTrendsTile } from "./HistoricalTrendsTile";
import { VoteFlowTile } from "@/screens/components/voteFlow/VoteFlowTile";
import { PartyResultsTile } from "./PartyResultsTile";
import { RegionMpsTile } from "./RegionMpsTile";
import { MpConnectionsTile } from "./MpConnectionsTile";
import { CarMakesTile } from "./CarMakesTile";
import { MpAssetsTile } from "./MpAssetsTile";
import { MpDeclarationsProvenance } from "./MpDeclarationsProvenance";
import { RegionMunicipalitiesMapTile } from "./RegionMunicipalitiesMapTile";
import { TopCandidatesStrip } from "./TopCandidatesStrip";
import { TopMunicipalitiesTile } from "./TopMunicipalitiesTile";
import { CensusDemographicsTile } from "./CensusDemographicsTile";
import { RegionalIndicatorsTile } from "./RegionalIndicatorsTile";
import { MunicipalTransfersTile } from "./MunicipalTransfersTile";
import { FlashMemoryTile } from "./FlashMemoryTile";
import { RecountTile } from "./RecountTile";
import { SuspiciousSectionsTile } from "./SuspiciousSectionsTile";
import { DashboardSection } from "./DashboardSection";
import { RegionLocalControlTile } from "./RegionLocalControlTile";
import { TopLocationsTile } from "./TopLocationsTile";
import { useNationalSummary } from "@/data/dashboard/useNationalSummary";
import { DIASPORA_FAQ, isDiasporaRegion } from "@/data/diaspora/diasporaFaq";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

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
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "bg";
  // МИР 32 (abroad). Has no municipalities/census/local-government, so those
  // sections self-hide; we additionally swap the municipality map for the
  // per-country tile and append a voting-abroad FAQ (mirrors the prerendered
  // SEO body for /municipality/32).
  const diaspora = isDiasporaRegion(regionCode);
  const { electionStats } = useElectionContext();
  const { data, isLoading } = useRegionSummary(regionCode);
  const { data: national } = useNationalSummary();
  const { data: problemSectionsStats } = useProblemSectionsStats();
  const declarationsHaveContent = useRegionDeclarationsHasContent({
    regionCode,
  });

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
    <section aria-label={t("dashboard")} className="my-4">
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <PartyChangeCard variant="gainer" change={data.topGainer} />
        <PartyChangeCard variant="loser" change={data.topLoser} />
        {/* Abroad sections register voters at the booth, so
            numRegisteredVoters is unreliable (turnout reads >100%); hide the
            card for МИР 32, as the prerendered SEO body already does. */}
        {diaspora ? null : (
          <TurnoutCard
            turnout={data.turnout}
            priorElection={data.priorElection}
          />
        )}
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
          {/* МИР 32 (abroad) loads the continents/world geo from
              /maps/regions/32.json — same tile, different map. */}
          <RegionMunicipalitiesMapTile regionCode={regionCode} />
          <PartyResultsTile parties={data.parties} regionCode={regionCode} />
        </div>
        {/* Diaspora-only: per-country results table beneath the continents
            map (each country links to its /sections/<code> page). */}
        {diaspora && national?.topDiaspora?.length ? (
          <TopLocationsTile
            variant="diaspora"
            items={national.topDiaspora}
            hideDetailsLink
          />
        ) : null}
        {electionStats?.hasPreferences ? (
          <TopCandidatesStrip parties={data.parties} regionCode={regionCode} />
        ) : null}
        <RegionMpsTile regionCode={regionCode} parties={data.parties} />
        <VoteFlowTile regionCode={regionCode} />
        <HistoricalTrendsTile regionCode={regionCode} />
      </DashboardSection>

      <DashboardSection
        id="geography"
        title={t("dashboard_section_geography")}
        icon={Map}
      >
        <TopMunicipalitiesTile parties={data.parties} regionCode={regionCode} />
        {/* Census data is published at the city level, not per Sofia MIR
              (S23/S24/S25), so the three Sofia electoral districts share the
              same demographics. The Sofia city dashboard renders this tile
              for the whole city; per-MIR pages omit it to avoid implying
              MIR-level census data exists. */}
        {!SOFIA_REGIONS.includes(regionCode) && (
          <CensusDemographicsTile regionCode={regionCode} />
        )}
        <RegionalIndicatorsTile regionCode={regionCode} />
        <MunicipalTransfersTile regionCode={regionCode} />
      </DashboardSection>

      {/* No municipalities/mayors/councils abroad — hide local government for
          МИР 32 (same rationale as the risk-sections section below). */}
      {diaspora ? null : (
        <DashboardSection
          id="local_government"
          title={t("dashboard_section_local_government")}
          icon={Landmark}
        >
          <RegionLocalControlTile regionCode={regionCode} />
        </DashboardSection>
      )}

      <DashboardSection
        id="anomalies"
        title={t("dashboard_section_anomalies")}
        icon={AlertTriangle}
      >
        <FlashMemoryTile parties={data.parties} regionCode={regionCode} />
        <SuspiciousSectionsTile
          parties={data.parties}
          regionCode={regionCode}
        />
        <RecountTile parties={data.parties} regionCode={regionCode} />
      </DashboardSection>

      {/* "Рискови гласове" flags Roma-neighbourhood polling sections inside
          Bulgaria — there are no such sections abroad, so hide it for МИР 32. */}
      {diaspora ? null : (
        <DashboardSection
          id="neighborhoods"
          title={t("dashboard_section_neighborhoods")}
          icon={Building2}
        >
          <ProblemSectionsTile parties={data.parties} regionCode={regionCode} />
          <ProblemVotesByPartyTile regionCode={regionCode} />
          {problemSectionsStats?.length ? (
            <HistoricalTrendsTile stats={problemSectionsStats} />
          ) : null}
        </DashboardSection>
      )}

      {declarationsHaveContent && (
        <DashboardSection
          id="declarations"
          title={t("dashboard_section_declarations")}
          subtitle={<MpDeclarationsProvenance regionCode={regionCode} />}
          icon={Briefcase}
        >
          <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
            <MpConnectionsTile regionCode={regionCode} />
            <CarMakesTile regionCode={regionCode} hideProvenance />
          </div>
          <MpAssetsTile regionCode={regionCode} />
        </DashboardSection>
      )}

      {diaspora ? (
        <DashboardSection
          id="diaspora_faq"
          title={
            lang === "en"
              ? "Voting abroad — FAQ"
              : "Гласуване в чужбина — въпроси"
          }
          icon={HelpCircle}
        >
          <Accordion type="single" collapsible className="w-full">
            {DIASPORA_FAQ[lang].map((item, i) => (
              <AccordionItem key={item.q} value={`faq-${i}`}>
                <AccordionTrigger className="text-left text-base font-medium">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </DashboardSection>
      ) : null}
    </section>
  );
};
