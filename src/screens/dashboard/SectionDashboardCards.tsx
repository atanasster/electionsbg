import { FC } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Gauge, Landmark } from "lucide-react";
import { DashboardSectionId } from "@/data/articles/useArticles";
import { useSectionSummary } from "@/data/dashboard/useSectionSummary";
import { useSectionsVotes } from "@/data/sections/useSectionsVotes";
import { useSectionStats } from "@/data/sections/useSectionStats";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { LocalContextTile } from "./LocalContextTile";
import { PartyChangeCard } from "./cards/PartyChangeCard";
import { TurnoutCard } from "./cards/TurnoutCard";
import { PaperMachineCard } from "./cards/PaperMachineCard";
import { HistoricalTrendsTile } from "./HistoricalTrendsTile";
import { PartyResultsTile } from "./PartyResultsTile";
import { FlashMemoryTile } from "./FlashMemoryTile";
import { RecountTile } from "./RecountTile";
import { SectionRiskTile } from "./SectionRiskTile";
import { SectionRiskHistoryTile } from "./cards/SectionRiskHistoryTile";
import { DashboardSection } from "./DashboardSection";
import { SectionArticlesProvider } from "./SectionArticlesContext";

const SECTION_TOPICS: readonly DashboardSectionId[] = [
  "votes",
  "local_government",
  "anomalies",
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
  sectionCode: string;
};

export const SectionDashboardCards: FC<Props> = ({ sectionCode }) => {
  const { t } = useTranslation();
  const { data, isLoading } = useSectionSummary(sectionCode);
  const section = useSectionsVotes(sectionCode);
  const { stats } = useSectionStats(sectionCode);
  const { findMunicipality } = useMunicipalities();
  // Abroad sections live under the synthetic "32" oblast (continent
  // bundles like OC = Oceania, EU = Europe, …) and have no local-
  // elections data. Gate the local_government section here so we
  // don't render an empty heading; DashboardSection's
  // renderable-children check can't peek into a tile that internally
  // returns null.
  const muniLookup =
    section?.obshtina ? findMunicipality(section.obshtina) : null;
  const hasLocalContext = !!muniLookup && muniLookup.oblast !== "32";

  const basePath = `/section/${sectionCode}`;

  if (isLoading) {
    return (
      <section aria-label={t("dashboard")} className="my-4">
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <div className="grid gap-3 grid-cols-1 mt-3">
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
          <PartyResultsTile parties={data.parties} basePath={basePath} />
          <HistoricalTrendsTile stats={stats} />
        </DashboardSection>

        {hasLocalContext ? (
          <DashboardSection
            id="local_government"
            title={t("dashboard_section_local_government")}
            icon={Landmark}
          >
            <LocalContextTile
              obshtinaCode={section?.obshtina}
              ekatte={section?.ekatte}
              settlementName={section?.settlement}
            />
          </DashboardSection>
        ) : null}

        <DashboardSection
          id="anomalies"
          title={t("dashboard_section_anomalies")}
          icon={AlertTriangle}
        >
          <FlashMemoryTile
            parties={data.parties}
            results={section?.results}
            basePath={basePath}
          />
          <RecountTile
            parties={data.parties}
            results={section?.results}
            original={section?.original}
            basePath={basePath}
          />
          <SectionRiskTile sectionCode={sectionCode} />
          <SectionRiskHistoryTile sectionCode={sectionCode} />
        </DashboardSection>
      </section>
    </SectionArticlesProvider>
  );
};
