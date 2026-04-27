import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useSectionSummary } from "@/data/dashboard/useSectionSummary";
import { useSectionsVotes } from "@/data/sections/useSectionsVotes";
import { useSectionStats } from "@/data/sections/useSectionStats";
import { PartyChangeCard } from "./cards/PartyChangeCard";
import { TurnoutCard } from "./cards/TurnoutCard";
import { PaperMachineCard } from "./cards/PaperMachineCard";
import { HistoricalTrendsTile } from "./HistoricalTrendsTile";
import { PartyResultsTile } from "./PartyResultsTile";
import { FlashMemoryTile } from "./FlashMemoryTile";
import { RecountTile } from "./RecountTile";

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
      <div className="grid gap-3 grid-cols-1 mt-3">
        <PartyResultsTile parties={data.parties} basePath={basePath} />
      </div>
      <div className="grid gap-3 grid-cols-1 mt-3">
        <FlashMemoryTile
          parties={data.parties}
          results={section?.results}
          basePath={basePath}
        />
      </div>
      <div className="grid gap-3 grid-cols-1 mt-3">
        <RecountTile
          parties={data.parties}
          results={section?.results}
          original={section?.original}
          basePath={basePath}
        />
      </div>
      <div className="grid gap-3 grid-cols-1 mt-3">
        <HistoricalTrendsTile stats={stats} basePath={basePath} />
      </div>
    </section>
  );
};
