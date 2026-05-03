import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useNationalSummary } from "@/data/dashboard/useNationalSummary";
import { useElectionContext } from "@/data/ElectionContext";
import { PartyChangeCard } from "./cards/PartyChangeCard";
import { TurnoutCard } from "./cards/TurnoutCard";
import { PaperMachineCard } from "./cards/PaperMachineCard";
import { ProblemSectionsTile } from "./ProblemSectionsTile";
import { ProblemVotesByPartyTile } from "./ProblemVotesByPartyTile";
import { MandatesTile } from "./MandatesTile";
import { HistoricalTrendsTile } from "./HistoricalTrendsTile";
import { PartyResultsTile } from "./PartyResultsTile";
import { RegionsMapTile } from "./RegionsMapTile";
import { TopCandidatesStrip } from "./TopCandidatesStrip";
import { TopRegionsTile } from "./TopRegionsTile";
import { TopFinancingTile } from "./TopFinancingTile";
import { FlashMemoryTile } from "./FlashMemoryTile";
import { RecountTile } from "./RecountTile";
import { SuspiciousSectionsTile } from "./SuspiciousSectionsTile";
import { PollsTile } from "./PollsTile";
import { AccuracyTrendsTile } from "./AccuracyTrendsTile";
import { ArticlesTile } from "./ArticlesTile";

const SkeletonCard: FC<{ className?: string }> = ({
  className = "h-[160px]",
}) => (
  <div
    className={`rounded-xl border bg-card p-4 shadow-sm animate-pulse ${className}`}
  >
    <div className="h-3 w-24 bg-muted rounded mb-3" />
    <div className="h-7 w-32 bg-muted rounded" />
  </div>
);

export const DashboardCards: FC = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useNationalSummary();
  const { electionStats } = useElectionContext();

  // electionStats is derived synchronously from in-memory data, so we use it
  // to gate the same set of optional rows in both the skeleton and live
  // branches. Otherwise the skeleton would show rows for data that won't
  // appear, or vice versa.
  const hasFinancials = !!electionStats?.hasFinancials;
  const hasRecount = !!electionStats?.hasRecount;
  const hasFlash = !!electionStats?.hasSuemg;

  if (isLoading || !data) {
    if (!isLoading && !data) return null;
    return (
      <section aria-label={t("dashboard")} className="my-4">
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] mt-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] mt-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard />
        </div>
        {hasFlash ? (
          <div className="grid gap-3 grid-cols-1 mt-3">
            <SkeletonCard />
          </div>
        ) : null}
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard />
        </div>
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard />
        </div>
        {hasFinancials ? (
          <div className="grid gap-3 grid-cols-1 mt-3">
            <SkeletonCard />
          </div>
        ) : null}
        {hasRecount ? (
          <div className="grid gap-3 grid-cols-1 mt-3">
            <SkeletonCard />
          </div>
        ) : null}
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard />
        </div>
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard />
        </div>
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard />
        </div>
      </section>
    );
  }

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
        <RegionsMapTile />
        <PartyResultsTile parties={data.parties} />
      </div>
      <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] mt-3">
        <MandatesTile parties={data.parties} />
        <TopCandidatesStrip parties={data.parties} />
      </div>
      <div className="grid gap-3 grid-cols-1 mt-3">
        <TopRegionsTile parties={data.parties} />
      </div>
      {hasFlash ? (
        <div className="grid gap-3 grid-cols-1 mt-3">
          <FlashMemoryTile parties={data.parties} />
        </div>
      ) : null}
      <div className="grid gap-3 grid-cols-1 mt-3">
        <SuspiciousSectionsTile parties={data.parties} />
      </div>
      <div className="grid gap-3 grid-cols-1 mt-3">
        <ProblemSectionsTile parties={data.parties} />
      </div>
      <div className="grid gap-3 grid-cols-1 mt-3">
        <ProblemVotesByPartyTile />
      </div>
      {hasFinancials ? (
        <div className="grid gap-3 grid-cols-1 mt-3">
          <TopFinancingTile parties={data.parties} />
        </div>
      ) : null}
      {hasRecount ? (
        <div className="grid gap-3 grid-cols-1 mt-3">
          <RecountTile parties={data.parties} />
        </div>
      ) : null}
      <div className="grid gap-3 grid-cols-1 mt-3">
        <HistoricalTrendsTile />
      </div>
      <div className="grid gap-3 grid-cols-1 mt-3">
        <PollsTile />
      </div>
      <div className="grid gap-3 grid-cols-1 mt-3">
        <AccuracyTrendsTile />
      </div>
      <div className="grid gap-3 grid-cols-1 mt-3">
        <ArticlesTile />
      </div>
    </section>
  );
};
