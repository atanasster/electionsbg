import { FC } from "react";
import { PartyFiling, PartyInfo } from "@/data/dataTypes";
import {
  campaignCostFiling,
  campaignNonMonetaryCost,
  materialExpenseFiling,
  mediaExpenseFiling,
  outsideServicesFiling,
  pctChange,
  taxesFiling,
  totalFinancing,
  totalIncomeFiling,
} from "@/data/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Banknote, HandCoins, Scale } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HintedDataItem } from "@/ux/HintedDataItem";
import { OutsideServices } from "./OusideServices";
import { FinancingContributors } from "./FinancingContributors";
import { PartyBarChart } from "./PartyBarChart";
import { TaxesAndFees } from "./TaxesAndFees";
import { NonMonetary } from "./NonMonetary";
import { MediaPackage } from "./MediaPackage";
import { AccordionSummary } from "@/ux/AccordionSummary";

export const FilingSummary: FC<{
  filing?: PartyFiling;
  priorFiling?: PartyFiling;
  party?: PartyInfo;
}> = ({ filing, priorFiling, party }) => {
  const { t } = useTranslation();
  return (
    <AccordionSummary>
      <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 my-4`}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-md font-medium">
              {t("raised_funds")}
            </CardTitle>
            <HandCoins />
          </CardHeader>
          <CardContent>
            <HintedDataItem
              value={totalIncomeFiling(filing?.income)}
              pctChange={pctChange(
                totalIncomeFiling(filing?.income),
                totalIncomeFiling(priorFiling?.income),
              )}
              size="xl"
              pctSuffix=""
              valueExplainer={t("raised_funds_explainer")}
              pctExplainer={t("raised_funds_pct_change_explainer")}
            />

            <HintedDataItem
              value={totalFinancing(filing?.income.donors)}
              pctChange={pctChange(
                totalFinancing(filing?.income.donors),
                totalFinancing(priorFiling?.income.donors),
              )}
              valueLabel={`${t("from")} ${t("donors").toLowerCase()}`}
              valueExplainer={
                <FinancingContributors
                  financing={filing?.income.donors}
                  priorFinancing={priorFiling?.income.donors}
                />
              }
            />
            <HintedDataItem
              value={totalFinancing(filing?.income.candidates)}
              pctChange={pctChange(
                totalFinancing(filing?.income.candidates),
                totalFinancing(priorFiling?.income.candidates),
              )}
              valueLabel={`${t("from")} ${t("candidates").toLowerCase()}`}
              valueExplainer={
                <FinancingContributors
                  financing={filing?.income.candidates}
                  priorFinancing={priorFiling?.income.candidates}
                />
              }
            />
            <HintedDataItem
              value={totalFinancing(filing?.income.party)}
              pctChange={pctChange(
                totalFinancing(filing?.income.party),
                totalFinancing(priorFiling?.income.party),
              )}
              valueLabel={`${t("from")} ${t("parties").toLowerCase()}`}
              valueExplainer={
                <FinancingContributors
                  financing={filing?.income.party}
                  priorFinancing={priorFiling?.income.party}
                />
              }
            />
            <HintedDataItem
              value={filing?.income.mediaPackage}
              pctChange={pctChange(
                filing?.income.mediaPackage,
                priorFiling?.income.mediaPackage,
              )}
              valueLabel={`${t("from")} ${t("media_package").toLowerCase()}`}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-md font-medium">
              {t("campaign_cost")}
            </CardTitle>
            <Banknote />
          </CardHeader>
          <CardContent>
            <HintedDataItem
              value={campaignCostFiling(filing)}
              pctChange={pctChange(
                campaignCostFiling(filing),
                campaignCostFiling(priorFiling),
              )}
              valueExplainer={t("campaign_cost_explainer")}
              pctExplainer={t("campaign_cost_pct_change_explainer")}
              pctSuffix=""
              size="xl"
            />
            <HintedDataItem
              value={materialExpenseFiling(filing?.expenses)}
              pctChange={pctChange(
                materialExpenseFiling(filing?.expenses),
                materialExpenseFiling(priorFiling?.expenses),
              )}
              valueLabel={t("material")}
            />
            <HintedDataItem
              className="max-w-96"
              value={outsideServicesFiling(filing?.expenses)}
              pctChange={pctChange(
                outsideServicesFiling(filing?.expenses),
                outsideServicesFiling(priorFiling?.expenses),
              )}
              valueLabel={t("outside_services")}
              valueExplainer={
                <OutsideServices
                  services={filing?.expenses.external}
                  priorServices={priorFiling?.expenses.external}
                />
              }
            />

            <HintedDataItem
              value={filing?.expenses.compensations}
              pctChange={pctChange(
                filing?.expenses.compensations,
                priorFiling?.expenses.compensations,
              )}
              valueLabel={t("compensations")}
            />
            <HintedDataItem
              value={filing?.expenses.compensationTaxes}
              pctChange={pctChange(
                filing?.expenses.compensationTaxes,
                priorFiling?.expenses.compensationTaxes,
              )}
              valueLabel={t("compensations_taxes")}
            />
            <HintedDataItem
              value={taxesFiling(filing?.expenses.taxes)}
              pctChange={pctChange(
                taxesFiling(filing?.expenses.taxes),
                taxesFiling(priorFiling?.expenses.taxes),
              )}
              valueLabel={t("taxes_and_fees")}
              valueExplainer={
                <TaxesAndFees
                  taxes={filing?.expenses.taxes}
                  priorTaxes={priorFiling?.expenses.taxes}
                />
              }
            />
            <HintedDataItem
              value={filing?.expenses.businessTrips}
              pctChange={pctChange(
                filing?.expenses.businessTrips,
                priorFiling?.expenses.businessTrips,
              )}
              valueLabel={t("business_trips")}
            />
            <HintedDataItem
              value={filing?.expenses.donations}
              pctChange={pctChange(
                priorFiling?.expenses.donations,
                filing?.expenses.donations,
              )}
              valueLabel={t("donations")}
            />
            <HintedDataItem
              className="max-w-96"
              value={mediaExpenseFiling(filing?.expenses.mediaPackage)}
              pctChange={pctChange(
                mediaExpenseFiling(filing?.expenses.mediaPackage),
                mediaExpenseFiling(priorFiling?.expenses.mediaPackage),
              )}
              valueLabel={t("media_package")}
              valueExplainer={
                <MediaPackage
                  media={filing?.expenses.mediaPackage}
                  priorMedia={priorFiling?.expenses.mediaPackage}
                />
              }
            />
            <HintedDataItem
              value={campaignNonMonetaryCost(filing)}
              pctChange={pctChange(
                campaignNonMonetaryCost(filing),
                campaignNonMonetaryCost(priorFiling),
              )}
              valueLabel={t("non_monetary_contributions")}
              valueExplainer={
                <NonMonetary
                  income={filing?.income}
                  priorIncome={priorFiling?.income}
                />
              }
            />
          </CardContent>
        </Card>
        {party && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-md font-medium first-letter:uppercase">
                {`${t("elections")} / ${t("financing")}`}
              </CardTitle>
              <Scale />
            </CardHeader>
            <CardContent>
              <PartyBarChart
                party={party}
                filing={filing}
                priorFiling={priorFiling}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </AccordionSummary>
  );
};
