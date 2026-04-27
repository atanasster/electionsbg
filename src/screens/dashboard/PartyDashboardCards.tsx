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
import { PartyRegionSwingsTile } from "./PartyRegionSwingsTile";
import { PartyAssessmentTile } from "./PartyAssessmentTile";
import { PartyExpenseBreakdownTile } from "./PartyExpenseBreakdownTile";
import { PartyTopDonorsTile } from "./PartyTopDonorsTile";
import { PartyTrajectoryTile } from "./PartyTrajectoryTile";
import { PartyPollingDeltaTile } from "./PartyPollingDeltaTile";
import { useFinancing } from "@/screens/components/party/campaign_financing/useFinancing";

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

type Props = { party: PartyInfo };

export const PartyDashboardCards: FC<Props> = ({ party }) => {
  const { t } = useTranslation();
  const { electionStats } = useElectionContext();
  const { data, isLoading } = usePartySummary(party);
  const hasFinancials = !!electionStats?.hasFinancials;
  const { financing, priorFinancing } = useFinancing(
    hasFinancials ? party : undefined,
  );

  if (isLoading || !data) {
    return (
      <section aria-label={t("dashboard")} className="my-4">
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <div className="grid gap-3 grid-cols-1 mt-3">
          <SkeletonCard className="h-[420px]" />
        </div>
      </section>
    );
  }

  return (
    <section aria-label={t("dashboard")} className="my-4">
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <PartyVotersCard data={data} />
        <PartyPositionCard data={data} />
        <PartyPaperMachineCard
          paperMachine={data.paperMachine}
          priorElection={data.priorElection}
        />
        <PartyTopRegionCard data={data} />
      </div>

      {hasFinancials ? (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 mt-3">
          <PartyRaisedFundsCard
            filing={financing?.data.filing}
            priorFiling={priorFinancing?.data.filing}
            priorElection={data.priorElection}
            partyNickName={data.nickName}
          />
          <PartyCampaignCostCard
            filing={financing?.data.filing}
            priorFiling={priorFinancing?.data.filing}
            priorElection={data.priorElection}
            partyNickName={data.nickName}
          />
          <PartyTopExpenseCard
            filing={financing?.data.filing}
            partyNickName={data.nickName}
          />
          <PartyDonorsCountCard
            financing={financing}
            partyNickName={data.nickName}
          />
        </div>
      ) : null}

      <div className="grid gap-3 grid-cols-1 mt-3">
        <PartyAssessmentTile data={data} />
      </div>

      <div className="grid gap-3 grid-cols-1 mt-3">
        <PartyRegionSwingsTile data={data} />
      </div>

      {electionStats?.hasPreferences ? (
        <div className="grid gap-3 grid-cols-1 mt-3">
          <PartyTopCandidatesTile data={data} />
        </div>
      ) : null}

      <div className="grid gap-3 grid-cols-1 mt-3">
        <PartyTopRegionsTile data={data} />
      </div>

      <div className="grid gap-3 grid-cols-1 mt-3">
        <PartyTrajectoryTile data={data} />
      </div>

      <div className="grid gap-3 grid-cols-1 mt-3">
        <PartyPollingDeltaTile data={data} />
      </div>

      {hasFinancials ? (
        <>
          <div className="grid gap-3 grid-cols-1 mt-3">
            <PartyExpenseBreakdownTile
              filing={financing?.data.filing}
              priorFiling={priorFinancing?.data.filing}
              color={data.color}
            />
          </div>
          <div className="grid gap-3 grid-cols-1 mt-3">
            <PartyTopDonorsTile
              financing={financing}
              partyNickName={data.nickName}
              color={data.color}
            />
          </div>
        </>
      ) : null}

      <div className="grid gap-3 grid-cols-1 mt-3">
        <PartyTopMunicipalitiesTile data={data} />
      </div>

      <div className="grid gap-3 grid-cols-1 mt-3">
        <PartyTopSettlementsTile data={data} />
      </div>
    </section>
  );
};
