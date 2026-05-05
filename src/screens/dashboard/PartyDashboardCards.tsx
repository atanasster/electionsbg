import { FC } from "react";
import { useTranslation } from "react-i18next";
import { PartyInfo } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { usePartySummary } from "@/data/dashboard/usePartySummary";
import { PartyVotersCard } from "./cards/PartyVotersCard";
import { PartyPositionCard } from "./cards/PartyPositionCard";
import { PartyPaperMachineCard } from "./cards/PartyPaperMachineCard";
import { PartyTopRegionCard } from "./cards/PartyTopRegionCard";
import { PartyRaisedFundsCard } from "./cards/PartyRaisedFundsCard";
import { PartyCampaignCostCard } from "./cards/PartyCampaignCostCard";
import { PartyTopExpenseCard } from "./cards/PartyTopExpenseCard";
import { PartyDonorsCountCard } from "./cards/PartyDonorsCountCard";
import { PartyTopRegionsTile } from "./PartyTopRegionsTile";
import { PartyTopMunicipalitiesTile } from "./PartyTopMunicipalitiesTile";
import { PartyTopSettlementsTile } from "./PartyTopSettlementsTile";
import { PartyTopCandidatesTile } from "./PartyTopCandidatesTile";
import { PartyMpAssetsTile } from "./PartyMpAssetsTile";
import { PartyRegionSwingsTile } from "./PartyRegionSwingsTile";
import { PartyAssessmentTile } from "./PartyAssessmentTile";
import { PartyExpenseBreakdownTile } from "./PartyExpenseBreakdownTile";
import { PartyTopDonorsTile } from "./PartyTopDonorsTile";
import { PartyTrajectoryTile } from "./PartyTrajectoryTile";
import { PartyPollingDeltaTile } from "./PartyPollingDeltaTile";
import { useFinancing } from "@/screens/components/party/campaign_financing/useFinancing";

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

// Per-section min-heights chosen to match the typical rendered tile height
// once data arrives. Skeleton + live layouts reserve identical vertical
// space, so async-loading tiles can't shift content below them. See the
// matching table in DashboardCards.tsx for the same pattern on the home page.
const TILE_HEIGHTS = {
  card: "min-h-[160px]",
  assessment: "min-h-[220px]",
  regionSwings: "min-h-[280px]",
  topCandidates: "min-h-[320px]",
  topRegions: "min-h-[440px]",
  trajectory: "min-h-[280px]",
  pollingDelta: "min-h-[280px]",
  expenseBreakdown: "min-h-[420px]",
  topDonors: "min-h-[360px]",
  topMunicipalities: "min-h-[440px]",
  topSettlements: "min-h-[440px]",
} as const;

type Props = { party: PartyInfo };

export const PartyDashboardCards: FC<Props> = ({ party }) => {
  const { t } = useTranslation();
  const { electionStats } = useElectionContext();
  const { data, isLoading } = usePartySummary(party);
  const hasFinancials = !!electionStats?.hasFinancials;
  const hasPreferences = !!electionStats?.hasPreferences;
  const { financing, priorFinancing } = useFinancing(
    hasFinancials ? party : undefined,
  );

  if (isLoading || !data) {
    // Skeleton mirrors the live layout 1:1 (same sections, same conditional
    // rows, same min-heights). Without this, ~10 extra rows drop in below
    // the loading skeleton when data arrives, causing CLS for anything
    // visible above the fold to shift on hydration of #root.
    return (
      <section aria-label={t("dashboard")} className="my-4">
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <SkeletonCard className={TILE_HEIGHTS.card} />
          <SkeletonCard className={TILE_HEIGHTS.card} />
          <SkeletonCard className={TILE_HEIGHTS.card} />
          <SkeletonCard className={TILE_HEIGHTS.card} />
        </div>
        {hasFinancials ? (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 mt-3">
            <SkeletonCard className={TILE_HEIGHTS.card} />
            <SkeletonCard className={TILE_HEIGHTS.card} />
            <SkeletonCard className={TILE_HEIGHTS.card} />
            <SkeletonCard className={TILE_HEIGHTS.card} />
          </div>
        ) : null}
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard className={TILE_HEIGHTS.assessment} />
        </div>
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard className={TILE_HEIGHTS.regionSwings} />
        </div>
        {hasPreferences ? (
          <div className="grid gap-3 grid-cols-1 mt-3">
            <SkeletonCard className={TILE_HEIGHTS.topCandidates} />
          </div>
        ) : null}
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard className={TILE_HEIGHTS.topRegions} />
        </div>
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard className={TILE_HEIGHTS.trajectory} />
        </div>
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard className={TILE_HEIGHTS.pollingDelta} />
        </div>
        {hasFinancials ? (
          <>
            <div className="grid gap-3 grid-cols-1 mt-3">
              <SkeletonCard className={TILE_HEIGHTS.expenseBreakdown} />
            </div>
            <div className="grid gap-3 grid-cols-1 mt-3">
              <SkeletonCard className={TILE_HEIGHTS.topDonors} />
            </div>
          </>
        ) : null}
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard className={TILE_HEIGHTS.topMunicipalities} />
        </div>
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard className={TILE_HEIGHTS.topSettlements} />
        </div>
      </section>
    );
  }

  return (
    <section aria-label={t("dashboard")} className="my-4">
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <div className={TILE_HEIGHTS.card}>
          <PartyVotersCard data={data} />
        </div>
        <div className={TILE_HEIGHTS.card}>
          <PartyPositionCard data={data} />
        </div>
        <div className={TILE_HEIGHTS.card}>
          <PartyPaperMachineCard
            paperMachine={data.paperMachine}
            priorElection={data.priorElection}
          />
        </div>
        <div className={TILE_HEIGHTS.card}>
          <PartyTopRegionCard data={data} />
        </div>
      </div>

      {hasFinancials ? (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 mt-3">
          <div className={TILE_HEIGHTS.card}>
            <PartyRaisedFundsCard
              filing={financing?.data.filing}
              priorFiling={priorFinancing?.data.filing}
              priorElection={data.priorElection}
              partyNickName={data.nickName}
            />
          </div>
          <div className={TILE_HEIGHTS.card}>
            <PartyCampaignCostCard
              filing={financing?.data.filing}
              priorFiling={priorFinancing?.data.filing}
              priorElection={data.priorElection}
              partyNickName={data.nickName}
            />
          </div>
          <div className={TILE_HEIGHTS.card}>
            <PartyTopExpenseCard
              filing={financing?.data.filing}
              partyNickName={data.nickName}
            />
          </div>
          <div className={TILE_HEIGHTS.card}>
            <PartyDonorsCountCard
              financing={financing}
              partyNickName={data.nickName}
            />
          </div>
        </div>
      ) : null}

      <div className={`grid gap-3 grid-cols-1 mt-3 ${TILE_HEIGHTS.assessment}`}>
        <PartyAssessmentTile data={data} />
      </div>

      <div
        className={`grid gap-3 grid-cols-1 mt-3 ${TILE_HEIGHTS.regionSwings}`}
      >
        <PartyRegionSwingsTile data={data} />
      </div>

      {hasPreferences ? (
        <div
          className={`grid gap-3 grid-cols-1 mt-3 ${TILE_HEIGHTS.topCandidates}`}
        >
          <PartyTopCandidatesTile data={data} />
        </div>
      ) : null}

      {hasPreferences ? (
        <div className="grid gap-3 grid-cols-1 mt-3">
          <PartyMpAssetsTile data={data} />
        </div>
      ) : null}

      <div className={`grid gap-3 grid-cols-1 mt-3 ${TILE_HEIGHTS.topRegions}`}>
        <PartyTopRegionsTile data={data} />
      </div>

      <div className={`grid gap-3 grid-cols-1 mt-3 ${TILE_HEIGHTS.trajectory}`}>
        <PartyTrajectoryTile data={data} />
      </div>

      <div
        className={`grid gap-3 grid-cols-1 mt-3 ${TILE_HEIGHTS.pollingDelta}`}
      >
        <PartyPollingDeltaTile data={data} />
      </div>

      {hasFinancials ? (
        <>
          <div
            className={`grid gap-3 grid-cols-1 mt-3 ${TILE_HEIGHTS.expenseBreakdown}`}
          >
            <PartyExpenseBreakdownTile
              filing={financing?.data.filing}
              priorFiling={priorFinancing?.data.filing}
              color={data.color}
            />
          </div>
          <div
            className={`grid gap-3 grid-cols-1 mt-3 ${TILE_HEIGHTS.topDonors}`}
          >
            <PartyTopDonorsTile
              financing={financing}
              partyNickName={data.nickName}
              color={data.color}
            />
          </div>
        </>
      ) : null}

      <div
        className={`grid gap-3 grid-cols-1 mt-3 ${TILE_HEIGHTS.topMunicipalities}`}
      >
        <PartyTopMunicipalitiesTile data={data} />
      </div>

      <div
        className={`grid gap-3 grid-cols-1 mt-3 ${TILE_HEIGHTS.topSettlements}`}
      >
        <PartyTopSettlementsTile data={data} />
      </div>
    </section>
  );
};
