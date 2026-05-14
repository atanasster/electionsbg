// Plan vs. actual — the economic-grain variance for a complete fiscal year.
// The egov feed carries both the budget-law plan and the year-end execution,
// so for a complete year every economic line gets a real variance. Shows the
// three headline section variances, then the expenditure lines that deviated
// most from plan. Renders nothing when the year has no plan-vs-actual pair
// (e.g. the current year, before its budget law's plan column is published).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import { useBudgetEconomicReconciliation } from "@/data/budget/useBudgetReconciliation";
import type { ReconciliationRow } from "@/data/budget/types";

const SECTION_IDS = new Set([
  "eco-revenue",
  "eco-expenditure",
  "eco-eucontribution",
  "eco-balance",
  "eco-financing",
]);

const pctClass = (variancePct: number): string =>
  variancePct > 0
    ? "text-rose-600 dark:text-rose-400"
    : "text-amber-600 dark:text-amber-400";

const fmtPct = (v: number): string => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

const VarianceRow: FC<{ row: ReconciliationRow; label: string }> = ({
  row,
  label,
}) => {
  if (!row.planned || !row.executed || row.variancePct == null) return null;
  return (
    <li className="text-xs py-1 border-b border-border/40 last:border-b-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate">{label}</span>
        <span
          className={`tabular-nums shrink-0 font-semibold ${pctClass(
            row.variancePct,
          )}`}
        >
          {fmtPct(row.variancePct)}
        </span>
      </div>
      <div className="text-[11px] text-muted-foreground tabular-nums">
        {formatEur(row.planned.amountEur)} → {formatEur(row.executed.amountEur)}
      </div>
    </li>
  );
};

export const BudgetVarianceTile: FC<{ fiscalYear: number }> = ({
  fiscalYear,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { data: rows } = useBudgetEconomicReconciliation(fiscalYear);
  if (!rows) return null;

  const exact = rows.filter((r) => r.completeness === "exact");
  if (exact.length === 0) return null;

  const label = (r: ReconciliationRow): string =>
    lang === "bg" ? r.nodeNameBg : r.nodeNameEn || r.nodeNameBg;

  const section = (id: string): ReconciliationRow | undefined =>
    exact.find((r) => r.nodeId === id);
  const sections = [
    section("eco-revenue"),
    section("eco-expenditure"),
    section("eco-balance"),
  ].filter((r): r is ReconciliationRow => !!r);

  // Expenditure line items (not the section totals), biggest absolute deviation
  // from plan first.
  const lines = exact
    .filter(
      (r) =>
        r.kind === "expenditure" &&
        !SECTION_IDS.has(r.nodeId) &&
        r.varianceEur != null,
    )
    .sort((a, b) => Math.abs(b.varianceEur!) - Math.abs(a.varianceEur!))
    .slice(0, 8);

  return (
    <Card className="my-4" data-og="budget-variance">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Scale className="h-4 w-4" />
          {t("budget_variance_title") || "Plan vs. actual"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {(t("budget_variance_subtitle") ||
            "How execution diverged from the budget law, fiscal year") +
            " " +
            fiscalYear}
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="mb-3">
          {sections.map((s) => (
            <VarianceRow key={s.nodeId} row={s} label={label(s)} />
          ))}
        </ul>
        {lines.length > 0 ? (
          <>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
              {t("budget_variance_top_lines") ||
                "Largest deviations — spending"}
            </div>
            <ul>
              {lines.map((l) => (
                <VarianceRow key={l.nodeId} row={l} label={label(l)} />
              ))}
            </ul>
          </>
        ) : null}
        <p className="text-[11px] text-muted-foreground/80 mt-2">
          {t("budget_variance_note") ||
            "Positive = executed above plan, negative = below plan."}
        </p>
      </CardContent>
    </Card>
  );
};
