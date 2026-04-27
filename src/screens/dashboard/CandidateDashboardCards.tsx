import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useElectionContext } from "@/data/ElectionContext";
import { useCandidateSummary } from "@/data/dashboard/useCandidateSummary";
import { CandidatePreferencesCard } from "./cards/CandidatePreferencesCard";
import { CandidatePaperMachineCard } from "./cards/CandidatePaperMachineCard";
import { CandidateBallotCard } from "./cards/CandidateBallotCard";
import { CandidateTopRegionCard } from "./cards/CandidateTopRegionCard";
import { CandidateRegionsTile } from "./CandidateRegionsTile";
import { CandidateTrajectoryTile } from "./CandidateTrajectoryTile";
import { CandidateTopSettlementsTile } from "./CandidateTopSettlementsTile";
import { CandidateTopSectionsTile } from "./CandidateTopSectionsTile";
import { CandidateDonationsTile } from "./CandidateDonationsTile";

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

type Props = { name: string };

export const CandidateDashboardCards: FC<Props> = ({ name }) => {
  const { t } = useTranslation();
  const { electionStats } = useElectionContext();
  const { data, isLoading } = useCandidateSummary(name);
  const hasFinancials = !!electionStats?.hasFinancials;

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
        <CandidatePreferencesCard data={data} />
        <CandidatePaperMachineCard
          paperMachine={data.paperMachine}
          priorElection={data.priorElection}
        />
        <CandidateBallotCard data={data} />
        <CandidateTopRegionCard data={data} />
      </div>

      <div className="grid gap-3 grid-cols-1 mt-3">
        <CandidateRegionsTile data={data} />
      </div>

      <div className="grid gap-3 grid-cols-1 mt-3">
        <CandidateTrajectoryTile data={data} />
      </div>

      <div className="grid gap-3 grid-cols-1 mt-3">
        <CandidateTopSettlementsTile data={data} />
      </div>

      <div className="grid gap-3 grid-cols-1 mt-3">
        <CandidateTopSectionsTile data={data} />
      </div>

      {hasFinancials ? (
        <div className="grid gap-3 grid-cols-1 mt-3">
          <CandidateDonationsTile name={name} />
        </div>
      ) : null}
    </section>
  );
};
