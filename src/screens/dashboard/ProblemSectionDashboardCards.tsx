import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useProblemSectionSummary } from "@/data/dashboard/useProblemSectionSummary";
import { useProblemSectionsStats } from "@/data/reports/useProblemSectionsStats";
import { ProblemSectionsNeighborhood } from "@/data/reports/useProblemSections";
import { PartyChangeCard } from "./cards/PartyChangeCard";
import { TurnoutCard } from "./cards/TurnoutCard";
import { PaperMachineCard } from "./cards/PaperMachineCard";
import { PartyResultsTile } from "./PartyResultsTile";
import { SectionsMapTile } from "./SectionsMapTile";
import { TopSectionsTile } from "./TopSectionsTile";
import { FlashMemoryTile } from "./FlashMemoryTile";
import { RecountTile } from "./RecountTile";
import { HistoricalTrendsTile } from "./HistoricalTrendsTile";

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
  neighborhood: ProblemSectionsNeighborhood;
};

export const ProblemSectionDashboardCards: FC<Props> = ({ neighborhood }) => {
  const { t } = useTranslation();
  const { data, aggregate, isLoading } = useProblemSectionSummary(
    neighborhood.id,
  );
  const { data: stats } = useProblemSectionsStats();

  const basePath = `/reports/section/problem_sections/${neighborhood.id}`;

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

  if (!data || !aggregate) return null;

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
        <SectionsMapTile
          sections={neighborhood.sections}
          markerVariant="problem"
          tooltipBadge={t("problem_section_badge")}
        />
        <PartyResultsTile parties={data.parties} basePath={basePath} />
      </div>
      <div className="grid gap-3 grid-cols-1 mt-3">
        <TopSectionsTile
          sections={neighborhood.sections}
          seeDetailsHref={`${basePath}/list`}
        />
      </div>
      <div className="grid gap-3 grid-cols-1 mt-3">
        <FlashMemoryTile
          parties={data.parties}
          results={aggregate.results}
          basePath={basePath}
        />
      </div>
      <div className="grid gap-3 grid-cols-1 mt-3">
        <RecountTile
          parties={data.parties}
          results={aggregate.results}
          original={aggregate.original}
          basePath={basePath}
        />
      </div>
      {stats?.length ? (
        <div className="grid gap-3 grid-cols-1 mt-3">
          <HistoricalTrendsTile stats={stats} basePath={basePath} />
        </div>
      ) : null}
    </section>
  );
};
