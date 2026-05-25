// Slim teaser above the full ministries table — surfaces the five spending
// units whose execution diverged most from the original ЗДБРБ plan in the
// most recent closed fiscal year. Variance is the political story; the full
// ministries table buries it under €-sorted ranking. This tile elevates it.
//
// Renders nothing until a year has at least a handful of `completeness:exact`
// admin rows (both planned and executed amounts present). Auto-resolves the
// latest such year — typically lags КФП by one fiscal year because the per-
// ministry execution reports drop in spring after the calendar year closes.

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import { useBudgetIndex } from "@/data/budget/useBudget";
import { useBudgetAdminReconciliation } from "@/data/budget/useBudgetReconciliation";
import type { ReconciliationRow } from "@/data/budget/types";

const TOP_N = 5;
// Skip absolute % variances below this — tiny line items can swing in raw %
// terms without being interesting (e.g. a €30k commission with €15k overrun
// reads as +50%). Five percentage points is conservative enough to keep the
// list focused on consequential moves.
const MIN_VARIANCE_PCT = 5;
// Skip ministries below this planned amount — a 100% overrun on a €5M unit
// crowds out a 10% overrun on a €1B unit. The dashboard's audience cares
// more about the latter.
const MIN_PLANNED_EUR = 20_000_000;

const compactEur = (v: number): string => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
  return formatEur(v);
};

const fmtPct = (v: number): string => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

interface Row {
  nodeId: string;
  labelBg: string;
  labelEn: string;
  planned: number;
  executed: number;
  variancePct: number;
}

const pickRows = (rows: ReconciliationRow[] | null | undefined): Row[] => {
  if (!rows) return [];
  const out: Row[] = [];
  for (const r of rows) {
    if (r.kind !== "expenditure") continue;
    if (r.completeness !== "exact") continue;
    if (r.planned?.amountEur == null) continue;
    if (r.executed?.amountEur == null) continue;
    if (r.variancePct == null) continue;
    if (Math.abs(r.variancePct) < MIN_VARIANCE_PCT) continue;
    if (r.planned.amountEur < MIN_PLANNED_EUR) continue;
    out.push({
      nodeId: r.nodeId,
      labelBg: r.nodeNameBg,
      labelEn: r.nodeNameEn || r.nodeNameBg,
      planned: r.planned.amountEur,
      executed: r.executed.amountEur,
      variancePct: r.variancePct,
    });
  }
  out.sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct));
  return out.slice(0, TOP_N);
};

// Election-scoped year resolver. Try the selected fiscal year first (so the
// tile follows the dashboard's selectedFy chip), then walk back one and two
// years if the selected year doesn't have completeness:exact data yet —
// per-ministry Отчет PDFs land in spring after FY close, so the most
// recent year is usually too early. The render path tells the user when
// they're looking at a fallback year instead of the one they picked.
const FALLBACK_LATEST_YEAR = 2025;
const candidateYears = (
  selected: number | null | undefined,
  fiscalYears: { fiscalYear: number }[] | undefined,
): [number, number, number] => {
  const seed =
    selected ??
    (fiscalYears?.length
      ? Math.max(...fiscalYears.map((y) => y.fiscalYear))
      : FALLBACK_LATEST_YEAR);
  return [seed, seed - 1, seed - 2];
};

const exactRowCount = (rows: ReconciliationRow[] | null | undefined): number =>
  rows
    ? rows.filter(
        (r) =>
          r.kind === "expenditure" &&
          r.completeness === "exact" &&
          r.planned != null &&
          r.executed != null &&
          r.variancePct != null,
      ).length
    : 0;

const RowItem: FC<{ row: Row; lang: "bg" | "en" }> = ({ row, lang }) => {
  const label = lang === "bg" ? row.labelBg : row.labelEn;
  const up = row.variancePct > 0;
  const Arrow = up ? ArrowUp : ArrowDown;
  // Spending OVER plan is the more visually-loud case (extra money out the
  // door); UNDER plan is "didn't spend what was approved" — neutral-cautionary
  // rather than warning. Mirror the YoY palette on the composition tiles.
  const tone = up
    ? "text-rose-600 dark:text-rose-400"
    : "text-amber-600 dark:text-amber-400";
  return (
    <li className="flex items-baseline gap-2 py-1.5 border-b border-border/40 last:border-b-0 text-xs">
      <Link
        to={`/budget/ministry/${row.nodeId}`}
        className="flex-1 truncate text-primary hover:underline"
        title={label}
      >
        {label}
      </Link>
      <span className="text-muted-foreground tabular-nums shrink-0">
        {compactEur(row.planned)} → {compactEur(row.executed)}
      </span>
      <span
        className={`tabular-nums font-semibold shrink-0 w-20 text-right whitespace-nowrap ${tone}`}
      >
        <Arrow className="inline h-3 w-3 -mt-0.5" /> {fmtPct(row.variancePct)}
      </span>
    </li>
  );
};

export const BudgetTopDeviationsTile: FC<{ fiscalYear?: number | null }> = ({
  fiscalYear,
}) => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { data: index } = useBudgetIndex();
  const [yearA, yearB, yearC] = candidateYears(fiscalYear, index?.fiscalYears);
  // Fan out across the selected year + the two prior years; React Query
  // caches each independently so flipping between them is free. Prefer the
  // selected year if it has ≥3 exact rows; otherwise walk back. The user
  // sees a "(latest available: X)" hint when we fall back.
  const a = useBudgetAdminReconciliation(yearA);
  const b = useBudgetAdminReconciliation(yearB);
  const c = useBudgetAdminReconciliation(yearC);
  const { year, rows } = useMemo<{
    year: number | null;
    rows: ReconciliationRow[] | null | undefined;
  }>(() => {
    if (exactRowCount(a.data) >= 3) return { year: yearA, rows: a.data };
    if (exactRowCount(b.data) >= 3) return { year: yearB, rows: b.data };
    if (exactRowCount(c.data) >= 3) return { year: yearC, rows: c.data };
    return { year: null, rows: null };
  }, [a.data, b.data, c.data, yearA, yearB, yearC]);

  const top = useMemo(() => pickRows(rows), [rows]);

  if (top.length === 0 || year == null) return null;

  const isFallback = fiscalYear != null && year !== fiscalYear;

  return (
    <Card
      id="budget-top-deviations"
      className="my-4 scroll-mt-20"
      data-og="budget-top-deviations"
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          {t("budget_top_deviations_title") || "Largest deviations from plan"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {(t("budget_top_deviations_subtitle") ||
            "Spending units whose execution diverged most from the original budget law, fiscal year") +
            " " +
            year}
          {isFallback ? (
            <span className="ml-1 text-amber-700 dark:text-amber-400">
              {(
                t("budget_top_deviations_fallback") ||
                "(execution report not yet published for {{requested}})"
              ).replace("{{requested}}", String(fiscalYear))}
            </span>
          ) : null}
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <ul>
          {top.map((r) => (
            <RowItem key={r.nodeId} row={r} lang={lang} />
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground/80 mt-2">
          {t("budget_top_deviations_caption") ||
            "Plan = original ЗДБРБ appropriation. Executed = year-end execution report (Отчет за изпълнението на програмния бюджет). Only ministries with both figures and a planned budget over €20M are shown."}
        </p>
      </CardContent>
    </Card>
  );
};
