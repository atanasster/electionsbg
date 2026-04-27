import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PieChart } from "lucide-react";
import { PartyFiling } from "@/data/dataTypes";
import {
  campaignCostFiling,
  campaignNonMonetaryCost,
  formatPct,
  formatThousands,
  materialExpenseFiling,
  mediaExpenseFiling,
  outsideServicesFiling,
  taxesFiling,
} from "@/data/utils";
import { Link } from "@/ux/Link";
import { StatCard } from "../StatCard";

type Props = { filing?: PartyFiling; partyNickName?: string };

export const PartyTopExpenseCard: FC<Props> = ({ filing, partyNickName }) => {
  const { t } = useTranslation();
  const { topName, topAmount, topPct } = useMemo(() => {
    if (!filing) return { topName: undefined, topAmount: 0, topPct: 0 };
    const total = campaignCostFiling(filing);
    const buckets: { name: string; amount: number }[] = [
      { name: t("material"), amount: materialExpenseFiling(filing.expenses) },
      {
        name: t("outside_services"),
        amount: outsideServicesFiling(filing.expenses),
      },
      { name: t("compensations"), amount: filing.expenses.compensations },
      {
        name: t("compensations_taxes"),
        amount: filing.expenses.compensationTaxes,
      },
      { name: t("taxes_and_fees"), amount: taxesFiling(filing.expenses.taxes) },
      { name: t("business_trips"), amount: filing.expenses.businessTrips },
      { name: t("donations"), amount: filing.expenses.donations },
      {
        name: t("media_package"),
        amount: mediaExpenseFiling(filing.expenses.mediaPackage),
      },
      {
        name: t("non_monetary_contributions"),
        amount: campaignNonMonetaryCost(filing),
      },
    ];
    const top = buckets.sort((a, b) => b.amount - a.amount)[0];
    return {
      topName: top?.amount ? top.name : undefined,
      topAmount: top?.amount ?? 0,
      topPct: total ? (100 * (top?.amount ?? 0)) / total : 0,
    };
  }, [filing, t]);

  if (!topName) {
    return (
      <StatCard
        label={t("dashboard_party_top_expense")}
        hint={t("dashboard_party_top_expense_hint")}
      >
        <div className="text-sm text-muted-foreground">
          {t("dashboard_no_data")}
        </div>
      </StatCard>
    );
  }

  return (
    <StatCard
      label={t("dashboard_party_top_expense")}
      hint={t("dashboard_party_top_expense_hint")}
    >
      <div className="flex items-baseline gap-2">
        <PieChart className="h-5 w-5 text-muted-foreground shrink-0" />
        <span className="text-xl font-bold truncate">{topName}</span>
      </div>
      <div className="text-sm font-medium tabular-nums">
        {formatThousands(topAmount)} {t("lv")}
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">
        {formatPct(topPct, 1)} {t("dashboard_of_campaign_cost")}
      </div>
      {partyNickName && (
        <Link
          to={`/party/${partyNickName}/expenses`}
          className="text-[10px] text-primary hover:underline mt-1"
          underline={false}
        >
          {t("dashboard_see_details")} →
        </Link>
      )}
    </StatCard>
  );
};
