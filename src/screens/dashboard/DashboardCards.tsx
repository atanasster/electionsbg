import { FC, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNationalSummary } from "@/data/dashboard/useNationalSummary";
import { useElectionContext } from "@/data/ElectionContext";
import { renderDashboardCard } from "@/ux/cardExport/dashboardCard";
import { ShareCardDialog } from "@/ux/cardExport/ShareCardDialog";
import { PartyChangeCard } from "./cards/PartyChangeCard";
import { TurnoutCard } from "./cards/TurnoutCard";
import { PaperMachineCard } from "./cards/PaperMachineCard";
import { ProblemSectionsTile } from "./ProblemSectionsTile";
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

export const DashboardCards: FC = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useNationalSummary();
  const { electionStats } = useElectionContext();
  const [shareOpen, setShareOpen] = useState(false);

  const renderCard = useCallback(() => {
    if (!data) return Promise.reject(new Error("no data"));
    return renderDashboardCard(data);
  }, [data]);

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
        <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] mt-3">
          <SkeletonCard className="h-[260px]" />
          <SkeletonCard className="h-[260px]" />
        </div>
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard className="h-[420px]" />
        </div>
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard className="h-[220px]" />
        </div>
      </section>
    );
  }

  if (!data) return null;

  return (
    <section aria-label={t("dashboard")} className="my-4">
      <div className="flex justify-end mb-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShareOpen(true)}
          aria-label={t("share_card_title")}
          title={t("share_card_button")}
          className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
        >
          <Share2 className="h-4 w-4" />
        </Button>
      </div>
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
      <div className="grid gap-3 grid-cols-1 mt-3">
        <FlashMemoryTile parties={data.parties} />
      </div>
      <div className="grid gap-3 grid-cols-1 mt-3">
        <SuspiciousSectionsTile parties={data.parties} />
      </div>
      <div className="grid gap-3 grid-cols-1 mt-3">
        <ProblemSectionsTile parties={data.parties} />
      </div>
      {electionStats?.hasFinancials ? (
        <div className="grid gap-3 grid-cols-1 mt-3">
          <TopFinancingTile parties={data.parties} />
        </div>
      ) : null}
      <div className="grid gap-3 grid-cols-1 mt-3">
        <RecountTile parties={data.parties} />
      </div>
      <div className="grid gap-3 grid-cols-1 mt-3">
        <HistoricalTrendsTile />
      </div>
      <ShareCardDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        title={t("share_card_title")}
        filenameBase={`electionsbg-${data.election}`}
        render={renderCard}
      />
    </section>
  );
};
