import { useTranslation } from "react-i18next";
import { Coins, UserRound, Wallet } from "lucide-react";
import { Title } from "@/ux/Title";
import { FinancingTable } from "./components/financing/FinancingTable";
import { FinancingKpiTiles } from "./components/financing/FinancingKpiTiles";
import { FinancingTrendsTile } from "./components/financing/FinancingTrendsTile";
import { FinancingSection } from "./components/financing/FinancingSection";
import { TopDonorsLeaderboard } from "./components/financing/TopDonorsLeaderboard";
import { DonorConcentration } from "./components/financing/DonorConcentration";
import { ExpensesByCategory } from "./components/financing/ExpensesByCategory";
import { AgenciesView } from "./components/financing/AgenciesView";
import { usePartiesFinancing } from "@/data/financing/usePartiesFinancing";
import { useDonorSummary } from "@/data/financing/useDonorSummary";
import { useAgenciesSummary } from "@/data/financing/useAgenciesSummary";

export const PartiesFinancing = () => {
  const { t } = useTranslation();
  const rows = usePartiesFinancing();
  const donors = useDonorSummary();
  const agencies = useAgenciesSummary();
  const hasData = rows.length > 0;

  return (
    <div className="w-full space-y-8 pb-12">
      <Title className="pt-8">{t("campaign_financing")}</Title>

      {hasData && (
        <FinancingKpiTiles rows={rows} donors={donors} agencies={agencies} />
      )}

      {/* The parties table is the anchor of this page — keep it directly under
          the headline KPIs. The funding-mix is folded into the income column. */}
      <FinancingTable hideTitle />

      {/* Historical fundraising trends across the elections with financials. */}
      <FinancingTrendsTile />

      {donors && (
        <FinancingSection title={t("income")} icon={Coins}>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 items-start">
            <TopDonorsLeaderboard
              donors={donors.topDonors}
              totalDonors={donors.distinctDonors}
              totalAmount={donors.totalMonetary + donors.totalNonMonetary}
            />
            {donors.topCandidates.length > 0 && (
              <TopDonorsLeaderboard
                donors={donors.topCandidates}
                title={t("financing_top_candidate_donors")}
                icon={UserRound}
                hint={t("financing_top_candidate_donors_hint")}
                nameHref={(d) => (d.slug ? `/candidate/${d.slug}` : undefined)}
              />
            )}
            <DonorConcentration stats={donors.byParty} />
            {donors.byPartyCandidates.length > 0 && (
              <DonorConcentration
                stats={donors.byPartyCandidates}
                title={t("financing_candidate_concentration")}
                icon={UserRound}
                hint={t("financing_candidate_concentration_hint")}
                countKey="financing_n_candidates"
              />
            )}
          </div>
        </FinancingSection>
      )}

      {hasData && (
        <FinancingSection
          title={t("expenses")}
          icon={Wallet}
          hint={t("financing_expenses_hint")}
        >
          <ExpensesByCategory />
          {agencies && <AgenciesView summary={agencies} />}
        </FinancingSection>
      )}
    </div>
  );
};
