import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PieChart } from "lucide-react";
import {
  campaignCostFiling,
  campaignNonMonetaryCost,
  formatPct,
  materialExpenseFiling,
  mediaExpenseFiling,
  outsideServicesFiling,
  taxesFiling,
} from "@/data/utils";
import { formatEur } from "@/lib/currency";
import { useFinancingRecords } from "@/data/financing/usePartiesFinancing";
import { StatCard } from "@/screens/dashboard/StatCard";

// National campaign-expense breakdown by category, summed across every party's
// filing. Same category buckets as the per-party PartyExpenseBreakdownTile.
export const ExpensesByCategory: FC = () => {
  const { t, i18n } = useTranslation();
  const records = useFinancingRecords();

  const { rows, total } = useMemo(() => {
    const filings = records.map((r) => r.filing);
    const sum = (fn: (f: (typeof filings)[number]) => number) =>
      filings.reduce((s, f) => s + (fn(f) || 0), 0);

    const buckets = [
      {
        key: "outside_services",
        name: t("outside_services"),
        amount: sum((f) => outsideServicesFiling(f.expenses)),
      },
      {
        key: "non_monetary_contributions",
        name: t("non_monetary_contributions"),
        amount: sum((f) => campaignNonMonetaryCost(f)),
      },
      {
        key: "media_package",
        name: t("media_package"),
        amount: sum((f) => mediaExpenseFiling(f.expenses.mediaPackage)),
      },
      {
        key: "material",
        name: t("material"),
        amount: sum((f) => materialExpenseFiling(f.expenses)),
      },
      {
        key: "compensations",
        name: t("compensations"),
        amount: sum((f) => f.expenses.compensations),
      },
      {
        key: "compensations_taxes",
        name: t("compensations_taxes"),
        amount: sum((f) => f.expenses.compensationTaxes),
      },
      {
        key: "taxes_and_fees",
        name: t("taxes_and_fees"),
        amount: sum((f) => taxesFiling(f.expenses.taxes)),
      },
      {
        key: "business_trips",
        name: t("business_trips"),
        amount: sum((f) => f.expenses.businessTrips),
      },
      {
        key: "donations",
        name: t("donations"),
        amount: sum((f) => f.expenses.donations),
      },
    ];
    const total = sum((f) => campaignCostFiling(f));
    const positive = buckets
      .filter((b) => b.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    const max = positive[0]?.amount ?? 1;
    return {
      total,
      rows: positive.map((b) => ({
        ...b,
        pctOfTotal: total ? (100 * b.amount) / total : 0,
        barPct: (b.amount / max) * 100,
      })),
    };
  }, [records, t]);

  if (rows.length === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-2">
            <PieChart className="h-4 w-4" />
            <span>{t("dashboard_party_expense_breakdown")}</span>
          </div>
          <span className="text-[10px] normal-case tabular-nums text-muted-foreground">
            {t("total")}: {formatEur(total, i18n.language)}
          </span>
        </div>
      }
      hint={t("financing_expenses_hint")}
      className="overflow-hidden"
    >
      <div className="mt-1 grid grid-cols-[minmax(0,1.2fr)_auto_auto] items-center gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[minmax(0,1.2fr)_auto_minmax(140px,2fr)_auto]">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard_category")}
        </span>
        <span className="text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("amount")}
        </span>
        <span className="hidden text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:inline">
          {t("dashboard_share_of_cost")}
        </span>
        <span className="text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("share")}
        </span>
        {rows.map((r) => (
          <div key={r.key} className="contents">
            <span className="truncate font-medium">{r.name}</span>
            <span className="text-right text-xs tabular-nums text-muted-foreground">
              {formatEur(r.amount, i18n.language)}
            </span>
            <div className="hidden h-2 overflow-hidden rounded-full bg-muted sm:block">
              <div
                className="h-full rounded-full bg-primary/70"
                style={{ width: `${Math.max(2, r.barPct)}%` }}
              />
            </div>
            <span className="text-right text-xs font-semibold tabular-nums">
              {formatPct(r.pctOfTotal, 1)}
            </span>
          </div>
        ))}
      </div>
    </StatCard>
  );
};
