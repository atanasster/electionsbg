import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useElectionContext } from "@/data/ElectionContext";
import { useRegionSummary } from "@/data/dashboard/useRegionSummary";
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
        <TurnoutCard
          turnout={data.turnout}
          priorElection={data.priorElection}
        />
        <PaperMachineCard
          paperMachine={data.paperMachine}
          priorElection={data.priorElection}
        />
      </div>
      <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] mt-3">
        <RegionMunicipalitiesMapTile regionCode={regionCode} />
        <PartyResultsTile parties={data.parties} regionCode={regionCode} />
      </div>
      {electionStats?.hasPreferences ? (
        <div className="grid gap-3 grid-cols-1 mt-3">
          <TopCandidatesStrip parties={data.parties} regionCode={regionCode} />
        </div>
      ) : null}
      <div className="grid gap-3 grid-cols-1 mt-3">
        <RegionMpsTile regionCode={regionCode} parties={data.parties} />
      </div>
      <div className="grid gap-3 grid-cols-1 mt-3">
        <MpConnectionsTile regionCode={regionCode} />
      </div>
      <div className="grid gap-3 grid-cols-1 mt-3">
        <TopMunicipalitiesTile parties={data.parties} regionCode={regionCode} />
      </div>
      <div className="grid gap-3 grid-cols-1 mt-3">
        <FlashMemoryTile parties={data.parties} regionCode={regionCode} />
      </div>
      <div className="grid gap-3 grid-cols-1 mt-3">
        <SuspiciousSectionsTile
          parties={data.parties}
          regionCode={regionCode}
        />
      </div>
      <div className="grid gap-3 grid-cols-1 mt-3">
        <ProblemSectionsTile parties={data.parties} regionCode={regionCode} />
      </div>
      <div className="grid gap-3 grid-cols-1 mt-3">
        <ProblemVotesByPartyTile regionCode={regionCode} />
      </div>
      <div className="grid gap-3 grid-cols-1 mt-3">
        <RecountTile parties={data.parties} regionCode={regionCode} />
      </div>
      <div className="grid gap-3 grid-cols-1 mt-3">
        <HistoricalTrendsTile regionCode={regionCode} />
      </div>
    </section>
  );
};
