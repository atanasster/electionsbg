import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Coins, Gauge, Map } from "lucide-react";
import { DashboardSectionId } from "@/data/articles/useArticles";
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
import { DashboardSection } from "./DashboardSection";
import { SectionArticlesProvider } from "./SectionArticlesContext";

const SECTION_TOPICS: readonly DashboardSectionId[] = [
  "votes",
  "geography",
  "financing",
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
  name: string;
  /** Slug used for in-page navigation links (regions / sections / donations).
   * Defaults to URL-encoded name when omitted (legacy callers). When present,
   * keeps disambiguation context alive across click-throughs. */
  linkSlug?: string;
};

export const CandidateDashboardCards: FC<Props> = ({ name, linkSlug }) => {
  const { t } = useTranslation();
  const { electionStats } = useElectionContext();
  const { data, isLoading } = useCandidateSummary(name);
  const hasFinancials = !!electionStats?.hasFinancials;
  const navSlug = linkSlug ?? encodeURIComponent(name);

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
    <SectionArticlesProvider order={SECTION_TOPICS}>
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

      <DashboardSection
        id="votes"
        title={t("dashboard_section_votes")}
        icon={Gauge}
        articleTopic="votes"
      >
        <CandidateRegionsTile data={data} linkSlug={navSlug} />
        <CandidateTrajectoryTile data={data} />
      </DashboardSection>

      <DashboardSection
        id="geography"
        title={t("dashboard_section_geography")}
        icon={Map}
        articleTopic="geography"
      >
        <CandidateTopSettlementsTile data={data} linkSlug={navSlug} />
        <CandidateTopSectionsTile data={data} linkSlug={navSlug} />
      </DashboardSection>

      {hasFinancials ? (
        <DashboardSection
          id="financing"
          title={t("dashboard_section_financing")}
          icon={Coins}
          articleTopic="financing"
        >
          <CandidateDonationsTile name={name} linkSlug={navSlug} />
        </DashboardSection>
      ) : null}
    </section>
    </SectionArticlesProvider>
  );
};
