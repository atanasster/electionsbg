// Home-dashboard summary tile for the budget pillar — scoped to the selected
// election. Shows full-year figures for the most recent fiscal year of the
// parliament's term that has data: the December actual for a complete year, a
// seasonal projection for the current one, or actual-so-far otherwise.
// Renders nothing when the term has no budget data ingested.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Coins, Landmark, Scale } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import { useBudgetIndex } from "@/data/budget/useBudget";
import { useBudgetTerm } from "@/data/budget/useBudgetTerm";
import { seriesView, type FySeries } from "@/data/budget/fiscalYear";
import type { FiscalYearSummary } from "@/data/budget/types";

export const BudgetSummaryTile: FC = () => {
  const { t } = useTranslation();
  const { data: index } = useBudgetIndex();
  const term = useBudgetTerm(index);
  const summary: FiscalYearSummary | null =
    term.years.find((y) => y.fiscalYear === term.selectedFy)?.summary ?? null;
  if (!summary) return null;

  const deficit = (summary.actual.balance?.amountEur ?? 0) < 0;
  const figures: Array<{
    label: string;
    series: FySeries;
    icon: typeof Coins;
    tone: string;
    absolute?: boolean;
  }> = [
    {
      label: t("budget_series_revenue") || "Revenue",
      series: "revenue",
      icon: Coins,
      tone: "text-emerald-600",
    },
    {
      label: t("budget_series_expenditure") || "Expenditure",
      series: "expenditure",
      icon: Landmark,
      tone: "text-rose-600",
    },
    {
      label: deficit
        ? t("budget_deficit") || "Budget deficit"
        : t("budget_surplus") || "Budget surplus",
      series: "balance",
      icon: Scale,
      tone: deficit ? "text-rose-600" : "text-emerald-600",
      absolute: true,
    },
  ];

  const statusText = summary.complete
    ? t("budget_fy_status_complete") || "executed"
    : `${t("budget_fy_status_inprogress") || "in progress"} · ${summary.asOf}`;

  return (
    <Card data-og="budget-summary">
      <CardHeader className="pb-2">
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">
            {t("budget_fy_heading") || "Fiscal year"} {summary.fiscalYear}
          </strong>{" "}
          — {statusText}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {t("budget_summary_scope") ||
            "Consolidated fiscal programme (cash basis, MoF)"}
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {figures.map((f) => {
            const v = seriesView(summary, f.series);
            const headline = f.absolute ? Math.abs(v.value) : v.value;
            return (
              <div key={f.label} className="flex flex-col gap-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {f.label}
                </div>
                <div className="flex items-baseline gap-1.5">
                  <f.icon className={`h-4 w-4 shrink-0 ${f.tone}`} />
                  <span className="text-lg font-bold tabular-nums break-words">
                    {formatEur(headline)}
                  </span>
                </div>
                {v.mode === "projected" ? (
                  <span className="text-[11px] text-amber-700 dark:text-amber-300">
                    {t("budget_mode_projected") || "projected"}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
