import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Briefcase,
  CalendarDays,
  Coins,
  FileCheck2,
  Gauge,
  Map,
} from "lucide-react";
import { PartyInfo } from "@/data/dataTypes";
import { DashboardSectionId } from "@/data/articles/useArticles";
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
import { PartyCarMakesTile } from "./PartyCarMakesTile";
import { PartyRegionSwingsTile } from "./PartyRegionSwingsTile";
import { PartyDemographicFingerprintTile } from "./PartyDemographicFingerprintTile";
import { PartyAssessmentTile } from "./PartyAssessmentTile";
import { PartyExpenseBreakdownTile } from "./PartyExpenseBreakdownTile";
import { PartyTopDonorsTile } from "./PartyTopDonorsTile";
import { FundingMixBars } from "@/screens/components/financing/FundingMixBars";
import { DonorConcentration } from "@/screens/components/financing/DonorConcentration";
import { PartyAgenciesTile } from "@/screens/components/financing/PartyAgenciesTile";
import { computeDonorStat } from "@/data/financing/partyDonorStat";
import { PartyFinancingRow } from "@/data/financing/usePartiesFinancing";
import { totalIncomeFiling } from "@/data/utils";
import { PartyTrajectoryTile } from "./PartyTrajectoryTile";
import { PartyPollingDeltaTile } from "./PartyPollingDeltaTile";
import { PartyAgencyForecastsTile } from "./PartyAgencyForecastsTile";
import { PartyCohesionTile } from "./PartyCohesionTile";
import { useFinancing } from "@/screens/components/party/campaign_financing/useFinancing";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { GFOPP_SLUG_BY_CANONICAL_ID } from "@/data/financing/partyAliases";
import { PartyAnnualReportPanel } from "./PartyAnnualReportPanel";
import { DashboardSection } from "./DashboardSection";
import { SectionArticlesProvider } from "./SectionArticlesContext";

const SECTION_TOPICS: readonly DashboardSectionId[] = [
  "votes",
  "geography",
  "declarations",
  "financing",
  "polling",
];

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
  fingerprint: "min-h-[480px]",
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
  const fundingRows = useMemo<PartyFinancingRow[]>(() => {
    const inc = financing?.data.filing.income;
    if (!inc) return [];
    return [
      {
        party: party.number,
        info: party,
        fromParties: inc.party.monetary + inc.party.nonMonetary,
        fromDonors: inc.donors.monetary + inc.donors.nonMonetary,
        fromCandidates: inc.candidates.monetary + inc.candidates.nonMonetary,
        media: inc.mediaPackage,
        total: totalIncomeFiling(inc),
      },
    ];
  }, [financing, party]);
  // Concentration computed from the already-loaded per-party filing (no extra
  // national donors.json fetch — see computeDonorStat).
  const donorStat = useMemo(
    () =>
      financing
        ? computeDonorStat(party.number, financing.data.fromDonors)
        : undefined,
    [financing, party.number],
  );

  // Court-of-Audit annual-report record — resolve this party to a gfopp
  // registry slug (curated alias map). Undefined when there's no match.
  const { canonicalIdFor } = useCanonicalParties();
  const canonicalId = canonicalIdFor(party.nickName);
  const annualReportSlug = canonicalId
    ? GFOPP_SLUG_BY_CANONICAL_ID[canonicalId]
    : undefined;

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
        <div className="grid gap-3 grid-cols-1 mt-8">
          <SkeletonCard className={TILE_HEIGHTS.assessment} />
          <SkeletonCard className={TILE_HEIGHTS.regionSwings} />
          <SkeletonCard className={TILE_HEIGHTS.fingerprint} />
          <SkeletonCard className={TILE_HEIGHTS.trajectory} />
        </div>
        <div className="grid gap-3 grid-cols-1 mt-8">
          <SkeletonCard className={TILE_HEIGHTS.topRegions} />
          <SkeletonCard className={TILE_HEIGHTS.topMunicipalities} />
          <SkeletonCard className={TILE_HEIGHTS.topSettlements} />
        </div>
        {hasPreferences ? (
          <div className="grid gap-3 grid-cols-1 mt-8">
            <SkeletonCard className={TILE_HEIGHTS.topCandidates} />
          </div>
        ) : null}
        {hasFinancials ? (
          <div className="grid gap-3 grid-cols-1 mt-8">
            <SkeletonCard className={TILE_HEIGHTS.expenseBreakdown} />
            <SkeletonCard className={TILE_HEIGHTS.topDonors} />
          </div>
        ) : null}
        <div className="grid gap-3 grid-cols-1 mt-8">
          <SkeletonCard className={TILE_HEIGHTS.pollingDelta} />
        </div>
      </section>
    );
  }

  return (
    <SectionArticlesProvider order={SECTION_TOPICS}>
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

        <DashboardSection
          id="votes"
          title={t("dashboard_section_votes")}
          icon={Gauge}
          articleTopic="votes"
        >
          <div className={TILE_HEIGHTS.assessment}>
            <PartyAssessmentTile data={data} />
          </div>
          <PartyCohesionTile party={party} />
          <PartyRegionSwingsTile data={data} />
          <div className={TILE_HEIGHTS.fingerprint}>
            <PartyDemographicFingerprintTile data={data} />
          </div>
          <PartyTrajectoryTile data={data} />
        </DashboardSection>

        <DashboardSection
          id="geography"
          title={t("dashboard_section_geography")}
          icon={Map}
          articleTopic="geography"
        >
          <div className={TILE_HEIGHTS.topRegions}>
            <PartyTopRegionsTile data={data} />
          </div>
          <div className={TILE_HEIGHTS.topMunicipalities}>
            <PartyTopMunicipalitiesTile data={data} />
          </div>
          <div className={TILE_HEIGHTS.topSettlements}>
            <PartyTopSettlementsTile data={data} />
          </div>
        </DashboardSection>

        {hasPreferences ? (
          <DashboardSection
            id="declarations"
            title={t("dashboard_section_candidates")}
            icon={Briefcase}
            articleTopic="declarations"
          >
            <div className={TILE_HEIGHTS.topCandidates}>
              <PartyTopCandidatesTile data={data} />
            </div>
            <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
              <PartyMpAssetsTile data={data} />
              <PartyCarMakesTile data={data} />
            </div>
          </DashboardSection>
        ) : null}

        {hasFinancials ? (
          <DashboardSection
            id="financing"
            title={t("dashboard_section_financing")}
            icon={Coins}
            articleTopic="financing"
          >
            {/* Two columns on wide screens with items-start so each tile sizes
                to its own content — no fixed min-heights (they over-reserve and
                leave big empty gaps for parties with short donor/expense lists,
                especially on narrower screens). */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 items-start">
              <FundingMixBars rows={fundingRows} hideChip />
              {donorStat ? <DonorConcentration stats={[donorStat]} /> : null}
              <PartyExpenseBreakdownTile
                filing={financing?.data.filing}
                priorFiling={priorFinancing?.data.filing}
                color={data.color}
              />
              <PartyTopDonorsTile
                financing={financing}
                partyNickName={data.nickName}
                color={data.color}
              />
              {financing?.data.agencies?.length ? (
                <PartyAgenciesTile agencies={financing.data.agencies} />
              ) : null}
            </div>
          </DashboardSection>
        ) : null}

        {annualReportSlug ? (
          <DashboardSection
            id="annual-reports"
            title={t("annual_reports_panel_title")}
            icon={FileCheck2}
          >
            <PartyAnnualReportPanel slug={annualReportSlug} />
          </DashboardSection>
        ) : null}

        <DashboardSection
          id="polling"
          title={t("dashboard_section_polling")}
          icon={CalendarDays}
          articleTopic="polling"
        >
          <PartyPollingDeltaTile data={data} />
          <PartyAgencyForecastsTile data={data} />
        </DashboardSection>
      </section>
    </SectionArticlesProvider>
  );
};
