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
import { PollsTile } from "./PollsTile";
import { AccuracyTrendsTile } from "./AccuracyTrendsTile";

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

// Per-section minimum heights chosen to match the typical rendered height of
// each tile once its data arrives. The skeleton state and the live state both
// reserve the same vertical space, so the page doesn't jump when async data
// resolves. Numbers are conservative estimates — the tile may grow taller
// (no shift, since a shorter skeleton expanding would still re-flow) but
// should never end up shorter than the reserved height. If a tile renders
// shorter than this, bump the value down — `min-h-` only sets a floor.
const TILE_HEIGHTS = {
  card: "min-h-[160px]",
  regionsMap: "min-h-[480px]",
  partyResults: "min-h-[480px]",
  mandates: "min-h-[280px]",
  topCandidates: "min-h-[200px]",
  topRegions: "min-h-[440px]",
  flashMemory: "min-h-[360px]",
  suspicious: "min-h-[240px]",
  problemSections: "min-h-[320px]",
  topFinancing: "min-h-[360px]",
  recount: "min-h-[240px]",
  historical: "min-h-[460px]",
  polls: "min-h-[280px]",
  accuracy: "min-h-[280px]",
} as const;

export const DashboardCards: FC = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useNationalSummary();
  const { electionStats } = useElectionContext();
  const [shareOpen, setShareOpen] = useState(false);

  const renderCard = useCallback(() => {
    if (!data) return Promise.reject(new Error("no data"));
    return renderDashboardCard(data);
  }, [data]);

  // electionStats is derived synchronously from in-memory data so it's safe
  // to read in both the skeleton and live branches — we use it to gate the
  // TopFinancing slot identically in both, so the row is either present in
  // both or absent in both. That keeps the dashboard's total height stable
  // across the skeleton → live transition.
  const hasFinancials = !!electionStats?.hasFinancials;

  // Skeleton mirrors the live layout below 1:1 — same sections in the same
  // order with the same reserved min-heights. When `data` arrives we replace
  // the skeleton with real tiles inside identically-shaped containers, so
  // the page below the dashboard stays put (zero CLS) instead of jumping
  // when ~7 extra rows drop in.
  if (isLoading || !data) {
    if (!isLoading && !data) return null;
    return (
      <section aria-label={t("dashboard")} className="my-4">
        {/* share-button row reserved (matches live layout) */}
        <div className="flex justify-end mb-2">
          <div className="h-8 w-8" />
        </div>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <SkeletonCard className={TILE_HEIGHTS.card} />
          <SkeletonCard className={TILE_HEIGHTS.card} />
          <SkeletonCard className={TILE_HEIGHTS.card} />
          <SkeletonCard className={TILE_HEIGHTS.card} />
        </div>
        <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] mt-3">
          <SkeletonCard className={TILE_HEIGHTS.regionsMap} />
          <SkeletonCard className={TILE_HEIGHTS.partyResults} />
        </div>
        <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] mt-3">
          <SkeletonCard className={TILE_HEIGHTS.mandates} />
          <SkeletonCard className={TILE_HEIGHTS.topCandidates} />
        </div>
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard className={TILE_HEIGHTS.topRegions} />
        </div>
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard className={TILE_HEIGHTS.flashMemory} />
        </div>
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard className={TILE_HEIGHTS.suspicious} />
        </div>
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard className={TILE_HEIGHTS.problemSections} />
        </div>
        {hasFinancials ? (
          <div className="grid gap-3 grid-cols-1 mt-3">
            <SkeletonCard className={TILE_HEIGHTS.topFinancing} />
          </div>
        ) : null}
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard className={TILE_HEIGHTS.recount} />
        </div>
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard className={TILE_HEIGHTS.historical} />
        </div>
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard className={TILE_HEIGHTS.polls} />
        </div>
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard className={TILE_HEIGHTS.accuracy} />
        </div>
      </section>
    );
  }

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
      {/*
        Wrap each tile slot in a div that locks the same min-height as the
        skeleton above. The wrapper takes the layout-shift hit instead of the
        tile contents, so any small over/undershoot in tile-rendered height
        doesn't ripple to the rest of the page.
      */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <div className={TILE_HEIGHTS.card}>
          <PartyChangeCard variant="gainer" change={data.topGainer} />
        </div>
        <div className={TILE_HEIGHTS.card}>
          <PartyChangeCard variant="loser" change={data.topLoser} />
        </div>
        <div className={TILE_HEIGHTS.card}>
          <TurnoutCard
            turnout={data.turnout}
            priorElection={data.priorElection}
          />
        </div>
        <div className={TILE_HEIGHTS.card}>
          <PaperMachineCard
            paperMachine={data.paperMachine}
            priorElection={data.priorElection}
          />
        </div>
      </div>
      <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] mt-3">
        <div className={TILE_HEIGHTS.regionsMap}>
          <RegionsMapTile />
        </div>
        <div className={TILE_HEIGHTS.partyResults}>
          <PartyResultsTile parties={data.parties} />
        </div>
      </div>
      <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] mt-3">
        <div className={TILE_HEIGHTS.mandates}>
          <MandatesTile parties={data.parties} />
        </div>
        <div className={TILE_HEIGHTS.topCandidates}>
          <TopCandidatesStrip parties={data.parties} />
        </div>
      </div>
      <div className={`grid gap-3 grid-cols-1 mt-3 ${TILE_HEIGHTS.topRegions}`}>
        <TopRegionsTile parties={data.parties} />
      </div>
      <div className={`grid gap-3 grid-cols-1 mt-3 ${TILE_HEIGHTS.flashMemory}`}>
        <FlashMemoryTile parties={data.parties} />
      </div>
      <div className={`grid gap-3 grid-cols-1 mt-3 ${TILE_HEIGHTS.suspicious}`}>
        <SuspiciousSectionsTile parties={data.parties} />
      </div>
      <div
        className={`grid gap-3 grid-cols-1 mt-3 ${TILE_HEIGHTS.problemSections}`}
      >
        <ProblemSectionsTile parties={data.parties} />
      </div>
      {hasFinancials ? (
        <div
          className={`grid gap-3 grid-cols-1 mt-3 ${TILE_HEIGHTS.topFinancing}`}
        >
          <TopFinancingTile parties={data.parties} />
        </div>
      ) : null}
      <div className={`grid gap-3 grid-cols-1 mt-3 ${TILE_HEIGHTS.recount}`}>
        <RecountTile parties={data.parties} />
      </div>
      <div className={`grid gap-3 grid-cols-1 mt-3 ${TILE_HEIGHTS.historical}`}>
        <HistoricalTrendsTile />
      </div>
      <div className={`grid gap-3 grid-cols-1 mt-3 ${TILE_HEIGHTS.polls}`}>
        <PollsTile />
      </div>
      <div className={`grid gap-3 grid-cols-1 mt-3 ${TILE_HEIGHTS.accuracy}`}>
        <AccuracyTrendsTile />
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
