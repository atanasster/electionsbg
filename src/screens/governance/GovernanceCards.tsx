// Governance dashboard — stacked sections covering parliament, MP
// declarations, budget, procurement, party financing, macro/regional
// context, governments and articles. Mirrors the Elections-home shell
// (DashboardCards) but reads through useParliamentTerm rather than a
// raw election-cycle picker, and opens with a per-tile-timestamped
// HeadlineIndicatorStrip instead of headline KPI cards tied to one
// election.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Briefcase,
  Coins,
  Globe2,
  Landmark,
  ScrollText,
  Vote,
  Wallet,
} from "lucide-react";
import { useProcurementByNs } from "@/data/procurement/useProcurementByNs";
import { useBudgetIndex, useKfp } from "@/data/budget/useBudget";
import { useBudgetTerm } from "@/data/budget/useBudgetTerm";
import { useElectionContext } from "@/data/ElectionContext";
import { BudgetSummaryTile } from "@/screens/components/budget/BudgetSummaryTile";
import { BudgetSamePointTile } from "@/screens/components/budget/BudgetSamePointTile";
import { TopMpsTile } from "@/screens/components/procurement/TopMpsTile";
import { TopContractorsTile } from "@/screens/components/procurement/TopContractorsTile";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { MpConnectionsTile } from "@/screens/dashboard/MpConnectionsTile";
import { CarMakesTile } from "@/screens/dashboard/CarMakesTile";
import { MpAssetsTile } from "@/screens/dashboard/MpAssetsTile";
import { MpDeclarationsProvenance } from "@/screens/dashboard/MpDeclarationsProvenance";
import { ParliamentSection } from "@/screens/dashboard/ParliamentSection";
import { GovernmentsTile } from "@/screens/dashboard/GovernmentsTile";
import { TopFinancingTile } from "@/screens/dashboard/TopFinancingTile";
import { ArticlesTile } from "@/screens/dashboard/ArticlesTile";
import { SectionArticlesProvider } from "@/screens/dashboard/SectionArticlesContext";
import { useNationalSummary } from "@/data/dashboard/useNationalSummary";
import { DashboardSectionId } from "@/data/articles/useArticles";
import { HeadlineIndicatorStrip } from "./HeadlineIndicatorStrip";
import { GovernanceMacroTile } from "./GovernanceMacroTile";

// Governance topics that map onto article tags. We reuse the existing
// DashboardSectionId enum where the topic overlaps; for the macro and
// articles sections we just don't gate on a topic.
const GOVERNANCE_TOPICS: readonly DashboardSectionId[] = [
  "parliament",
  "declarations",
  "budget",
  "procurement",
  "financing",
];

export const GovernanceCards: FC = () => {
  const { t } = useTranslation();
  const { electionStats } = useElectionContext();
  const { data: nationalSummary } = useNationalSummary();
  const { data: procurementByNs } = useProcurementByNs();
  const { data: budgetIndex } = useBudgetIndex();
  const { data: kfp } = useKfp();
  const budgetTerm = useBudgetTerm(budgetIndex);
  const budgetSummary =
    budgetTerm.years.find((y) => y.fiscalYear === budgetTerm.selectedFy)
      ?.summary ?? null;

  const hasFinancials = !!electionStats?.hasFinancials;

  return (
    <SectionArticlesProvider order={GOVERNANCE_TOPICS}>
      <section
        aria-label={t("governance_dashboard") || "Governance"}
        className="my-4"
      >
        <HeadlineIndicatorStrip />

        <ParliamentSection />

        <DashboardSection
          id="declarations"
          title={t("dashboard_section_declarations")}
          subtitle={<MpDeclarationsProvenance />}
          icon={Briefcase}
          articleTopic="declarations"
        >
          <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
            <MpConnectionsTile hideProvenance />
            <CarMakesTile hideProvenance />
          </div>
          <MpAssetsTile />
        </DashboardSection>

        {budgetTerm.yearsWithData.length > 0 ? (
          <DashboardSection
            id="budget"
            title={t("dashboard_section_budget")}
            subtitle={
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{t("dashboard_section_budget_subtitle")}</span>
                <Link
                  to="/budget"
                  className="text-primary hover:underline whitespace-nowrap"
                >
                  {t("dashboard_section_budget_link")}
                </Link>
              </span>
            }
            icon={Wallet}
            articleTopic="budget"
          >
            <BudgetSummaryTile />
            {kfp &&
            budgetSummary &&
            !budgetSummary.complete &&
            budgetTerm.selectedFy != null ? (
              <BudgetSamePointTile
                observations={kfp.observations}
                fiscalYear={budgetTerm.selectedFy}
                monthsAvailable={budgetSummary.monthsAvailable}
              />
            ) : null}
          </DashboardSection>
        ) : null}

        {procurementByNs && procurementByNs.topMps.length > 0 ? (
          <DashboardSection
            id="procurement"
            title={t("dashboard_section_procurement")}
            subtitle={
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{t("dashboard_section_procurement_subtitle")}</span>
                <Link
                  to="/procurement"
                  className="text-primary hover:underline whitespace-nowrap"
                >
                  {t("dashboard_section_procurement_link")}
                </Link>
              </span>
            }
            icon={Landmark}
            articleTopic="procurement"
          >
            <div className="grid gap-3 grid-cols-1 xl:grid-cols-2">
              <TopMpsTile data={procurementByNs} />
              <TopContractorsTile byNs={procurementByNs} />
            </div>
          </DashboardSection>
        ) : null}

        {hasFinancials && nationalSummary?.parties ? (
          <DashboardSection
            id="financing"
            title={t("dashboard_section_financing")}
            subtitle={
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{t("governance_section_financing_subtitle") || ""}</span>
                <Link
                  to="/financing"
                  className="text-primary hover:underline whitespace-nowrap"
                >
                  {t("governance_section_financing_link") ||
                    t("dashboard_see_details")}
                </Link>
              </span>
            }
            icon={Coins}
            articleTopic="financing"
          >
            <TopFinancingTile parties={nationalSummary.parties} />
          </DashboardSection>
        ) : null}

        <DashboardSection
          id="macro"
          title={t("governance_section_macro") || "Macro & regional context"}
          icon={Globe2}
        >
          <GovernanceMacroTile />
        </DashboardSection>

        <DashboardSection
          id="governments"
          title={t("governments_title")}
          icon={Vote}
        >
          <GovernmentsTile />
        </DashboardSection>

        <DashboardSection
          id="articles"
          title={t("governance_section_articles") || "Articles"}
          icon={ScrollText}
        >
          <ArticlesTile shownTopics={GOVERNANCE_TOPICS} />
        </DashboardSection>
      </section>
    </SectionArticlesProvider>
  );
};
