import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Wallet } from "lucide-react";
import { PartyFiling } from "@/data/dataTypes";
import {
  campaignCostFiling,
  campaignNonMonetaryCost,
  formatPct,
  formatThousands,
  materialExpenseFiling,
  mediaExpenseFiling,
  outsideServicesFiling,
  pctChange,
  taxesFiling,
} from "@/data/utils";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

const DeltaBadge: FC<{ delta?: number }> = ({ delta }) => {
  if (delta === undefined)
    return <span className="text-xs text-muted-foreground">—</span>;
  const sign = delta > 0 ? "+" : "";
  const color =
    delta > 0
      ? "text-negative"
      : delta < 0
        ? "text-positive"
        : "text-muted-foreground";
  return (
    <span className={`tabular-nums text-xs font-medium ${color}`}>
      {sign}
      {delta.toFixed(1)}%
    </span>
  );
};

type Props = {
  filing?: PartyFiling;
  priorFiling?: PartyFiling;
  color?: string;
};

export const PartyExpenseBreakdownTile: FC<Props> = ({
  filing,
  priorFiling,
  color,
}) => {
  const { t } = useTranslation();

  const rows = useMemo(() => {
    if (!filing) return [];
    const total = campaignCostFiling(filing);

    const buckets: {
      key: string;
      name: string;
      amount: number;
      prior: number;
    }[] = [
      {
        key: "outside_services",
        name: t("outside_services"),
        amount: outsideServicesFiling(filing.expenses),
        prior: outsideServicesFiling(priorFiling?.expenses),
      },
      {
        key: "non_monetary_contributions",
        name: t("non_monetary_contributions"),
        amount: campaignNonMonetaryCost(filing),
        prior: campaignNonMonetaryCost(priorFiling),
      },
      {
        key: "media_package",
        name: t("media_package"),
        amount: mediaExpenseFiling(filing.expenses.mediaPackage),
        prior: mediaExpenseFiling(priorFiling?.expenses.mediaPackage),
      },
      {
        key: "material",
        name: t("material"),
        amount: materialExpenseFiling(filing.expenses),
        prior: materialExpenseFiling(priorFiling?.expenses),
      },
      {
        key: "compensations",
        name: t("compensations"),
        amount: filing.expenses.compensations,
        prior: priorFiling?.expenses.compensations ?? 0,
      },
      {
        key: "compensations_taxes",
        name: t("compensations_taxes"),
        amount: filing.expenses.compensationTaxes,
        prior: priorFiling?.expenses.compensationTaxes ?? 0,
      },
      {
        key: "taxes_and_fees",
        name: t("taxes_and_fees"),
        amount: taxesFiling(filing.expenses.taxes),
        prior: taxesFiling(priorFiling?.expenses.taxes),
      },
      {
        key: "business_trips",
        name: t("business_trips"),
        amount: filing.expenses.businessTrips,
        prior: priorFiling?.expenses.businessTrips ?? 0,
      },
      {
        key: "donations",
        name: t("donations"),
        amount: filing.expenses.donations,
        prior: priorFiling?.expenses.donations ?? 0,
      },
    ];

    const positive = buckets
      .filter((b) => b.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    const max = positive[0]?.amount ?? 1;

    return positive.map((b) => ({
      key: b.key,
      name: b.name,
      amount: b.amount,
      pctOfTotal: total ? (100 * b.amount) / total : 0,
      barPct: (b.amount / max) * 100,
      delta: pctChange(b.amount, b.prior),
    }));
  }, [filing, priorFiling, t]);

  if (rows.length === 0) return null;
  const total = campaignCostFiling(filing);
  const barColor = color ?? "#888";

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint
            text={t("dashboard_party_expense_breakdown_hint")}
            underline={false}
          >
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              <span>{t("dashboard_party_expense_breakdown")}</span>
            </div>
          </Hint>
          <span className="text-[10px] normal-case text-muted-foreground tabular-nums">
            {t("total")}: {formatThousands(total)} {t("lv")}
          </span>
        </div>
      }
      className="overflow-hidden"
    >
      <div className="grid grid-cols-[minmax(0,1.2fr)_auto_minmax(120px,2fr)_auto_auto] gap-x-3 gap-y-1.5 items-center mt-1 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard_category")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("amount")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard_share_of_cost")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("share")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("dashboard_change")}
        </span>
        {rows.map((r) => (
          <div key={r.key} className="contents">
            <span className="truncate font-medium">{r.name}</span>
            <span className="tabular-nums text-xs text-muted-foreground text-right">
              {formatThousands(r.amount)}
            </span>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(2, r.barPct)}%`,
                  backgroundColor: barColor,
                }}
              />
            </div>
            <span className="tabular-nums text-xs font-semibold text-right">
              {formatPct(r.pctOfTotal, 1)}
            </span>
            <span className="justify-self-end">
              <DeltaBadge delta={r.delta} />
            </span>
          </div>
        ))}
      </div>
    </StatCard>
  );
};
