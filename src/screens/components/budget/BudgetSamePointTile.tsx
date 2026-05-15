// "At this point in the year" — cross-year comparison anchored at the same
// fiscal month as the current in-progress year. For revenue, spending, the
// budget balance and the EU contribution, one horizontal bar per fiscal year
// of cumulative execution through month M (= summary.monthsAvailable). The
// current year is highlighted; a "% of plan" badge neutralises nominal growth,
// and a verdict line under the panels reports the delta vs the prior-years
// median.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import type { KfpObservation } from "@/data/budget/types";

interface PointDatum {
  fiscalYear: number;
  isCurrent: boolean;
  revenue: number | null;
  expenditure: number | null;
  balance: number | null;
  euContribution: number | null;
  planRevenue: number | null;
  planExpenditure: number | null;
  planEuContribution: number | null;
}

const monthOf = (period: string): number => parseInt(period.slice(5, 7), 10);

const collectAtMonth = (
  observations: KfpObservation[],
  cutoffMonth: number,
  lookback: number,
  currentFy: number,
): PointDatum[] => {
  const fyMap = new Map<number, PointDatum>();
  const minFy = currentFy - lookback + 1;
  for (const o of observations) {
    if (o.cadence !== "monthly") continue;
    if (monthOf(o.period) !== cutoffMonth) continue;
    const fy = o.fiscalYear;
    if (fy > currentFy || fy < minFy) continue;
    let d = fyMap.get(fy);
    if (!d) {
      d = {
        fiscalYear: fy,
        isCurrent: fy === currentFy,
        revenue: null,
        expenditure: null,
        balance: null,
        euContribution: null,
        planRevenue: null,
        planExpenditure: null,
        planEuContribution: null,
      };
      fyMap.set(fy, d);
    }
    const exec = o.executed.amountEur;
    const plan = o.planned?.amountEur ?? null;
    if (o.series === "revenue") {
      d.revenue = exec;
      d.planRevenue = plan;
    } else if (o.series === "expenditure") {
      d.expenditure = exec;
      d.planExpenditure = plan;
    } else if (o.series === "balance") {
      d.balance = exec;
    } else if (o.series === "euContribution") {
      d.euContribution = exec;
      d.planEuContribution = plan;
    }
  }
  return [...fyMap.values()].sort((a, b) => a.fiscalYear - b.fiscalYear);
};

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
};

const compactEur = (v: number): string => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
  if (abs >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v}`;
};

const fmtPct = (v: number): string => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;

interface Panel {
  key: string;
  label: string;
  tone: string;
  pickValue: (d: PointDatum) => number | null;
  pickPlan: (d: PointDatum) => number | null;
  // Render value as |value| (used for the balance panel so deficits show as
  // positive-length bars).
  absolute?: boolean;
}

const PanelChart: FC<{ data: PointDatum[]; panel: Panel; ofPlan: string }> = ({
  data,
  panel,
  ofPlan,
}) => {
  const rows = data.map((d) => {
    const raw = panel.pickValue(d);
    const val = raw == null ? null : panel.absolute ? Math.abs(raw) : raw;
    const plan = panel.pickPlan(d);
    const planAbs =
      plan == null ? null : panel.absolute ? Math.abs(plan) : plan;
    return { fy: d.fiscalYear, isCurrent: d.isCurrent, val, plan: planAbs };
  });
  const max = Math.max(...rows.map((r) => r.val ?? 0), 1);
  const anyPlan = rows.some((r) => r.plan != null && r.plan !== 0);

  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="text-xs font-semibold text-foreground mb-2">
        {panel.label}
      </div>
      <ul className="space-y-1.5">
        {rows.map((r) => {
          const width = r.val != null ? `${(r.val / max) * 100}%` : "0%";
          const pct =
            r.val != null && r.plan != null && r.plan !== 0
              ? (r.val / r.plan) * 100
              : null;
          return (
            <li
              key={r.fy}
              className={
                anyPlan
                  ? "grid grid-cols-[2.5rem_1fr_5.5rem] items-center gap-2 text-xs"
                  : "grid grid-cols-[2.5rem_1fr] items-center gap-2 text-xs"
              }
            >
              <span
                className={`tabular-nums ${
                  r.isCurrent
                    ? "font-bold text-primary"
                    : "text-muted-foreground"
                }`}
              >
                {r.fy}
              </span>
              <div className="relative h-4 rounded bg-muted/40">
                <div
                  className={`absolute inset-y-0 left-0 rounded ${panel.tone} ${
                    r.isCurrent ? "" : "opacity-40"
                  }`}
                  style={{ width }}
                />
                <span className="absolute inset-y-0 right-1 flex items-center text-[10px] tabular-nums text-foreground/90">
                  {r.val != null ? compactEur(r.val) : "—"}
                </span>
              </div>
              {anyPlan ? (
                <span
                  className={`text-right text-[10px] tabular-nums ${
                    pct == null
                      ? "text-muted-foreground/60"
                      : "text-muted-foreground"
                  }`}
                >
                  {pct == null ? "—" : `${pct.toFixed(0)}% ${ofPlan}`}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export const BudgetSamePointTile: FC<{
  observations: KfpObservation[];
  fiscalYear: number;
  monthsAvailable: number;
  lookback?: number;
}> = ({ observations, fiscalYear, monthsAvailable, lookback = 6 }) => {
  const { t, i18n } = useTranslation();
  if (monthsAvailable < 1 || monthsAvailable >= 12) return null;

  const data = collectAtMonth(
    observations,
    monthsAvailable,
    lookback,
    fiscalYear,
  );
  const current = data.find((d) => d.isCurrent);
  // Need the current year plus at least one prior year for the tile to mean
  // anything.
  if (!current || data.length < 2) return null;

  const lang = i18n.language === "bg" ? "bg" : "en";
  const monthLabel = new Date(
    Date.UTC(2020, monthsAvailable - 1, 1),
  ).toLocaleDateString(lang === "bg" ? "bg-BG" : "en-US", { month: "long" });

  const currentDeficit = (current.balance ?? 0) < 0;
  const ofPlan = t("budget_same_point_of_plan") || "of plan";

  const panels: Panel[] = [
    {
      key: "revenue",
      label: t("budget_series_revenue") || "Revenue",
      tone: "bg-emerald-500",
      pickValue: (d) => d.revenue,
      pickPlan: (d) => d.planRevenue,
    },
    {
      key: "expenditure",
      label: t("budget_series_expenditure") || "Expenditure",
      tone: "bg-rose-500",
      pickValue: (d) => d.expenditure,
      pickPlan: (d) => d.planExpenditure,
    },
    {
      key: "balance",
      label: currentDeficit
        ? t("budget_deficit") || "Budget deficit"
        : t("budget_surplus") || "Budget surplus",
      tone: currentDeficit ? "bg-rose-500" : "bg-emerald-500",
      pickValue: (d) => d.balance,
      pickPlan: () => null,
      absolute: true,
    },
    {
      key: "euContribution",
      label: t("budget_series_euContribution") || "EU budget contribution",
      tone: "bg-blue-500",
      pickValue: (d) => d.euContribution,
      pickPlan: (d) => d.planEuContribution,
    },
  ];

  const prior = data.filter((d) => !d.isCurrent);
  const medianFor = (
    pick: (d: PointDatum) => number | null,
    absolute = false,
  ): number | null => {
    const xs = prior
      .map(pick)
      .filter((x): x is number => x != null)
      .map((x) => (absolute ? Math.abs(x) : x));
    return median(xs);
  };

  const verdict = (
    label: string,
    currentVal: number | null,
    medianVal: number | null,
    absolute = false,
  ): string | null => {
    if (currentVal == null || medianVal == null || medianVal === 0) return null;
    const cv = absolute ? Math.abs(currentVal) : currentVal;
    // Skip when signs would flip the meaning (e.g. surplus year vs deficit
    // years) — the % delta is misleading there.
    if (!absolute && Math.sign(cv) !== Math.sign(medianVal)) return null;
    const delta = ((cv - medianVal) / Math.abs(medianVal)) * 100;
    return `${label} ${fmtPct(delta)}`;
  };

  const verdicts = [
    verdict(
      t("budget_series_revenue") || "Revenue",
      current.revenue,
      medianFor((d) => d.revenue),
    ),
    verdict(
      t("budget_series_expenditure") || "Expenditure",
      current.expenditure,
      medianFor((d) => d.expenditure),
    ),
    verdict(
      currentDeficit
        ? t("budget_deficit") || "Budget deficit"
        : t("budget_surplus") || "Budget surplus",
      current.balance,
      medianFor((d) => d.balance, true),
      true,
    ),
  ].filter((s): s is string => s != null);

  const subtitle = (
    t("budget_same_point_subtitle") ||
    "Cumulative through {{month}} · fiscal years {{from}}–{{to}}"
  )
    .replace("{{month}}", monthLabel)
    .replace("{{from}}", String(data[0].fiscalYear))
    .replace("{{to}}", String(data[data.length - 1].fiscalYear));

  return (
    <Card className="my-4" data-og="budget-same-point">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" />
          {t("budget_same_point_title") || "At this point in the year"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {panels.map((p) => (
            <PanelChart key={p.key} data={data} panel={p} ofPlan={ofPlan} />
          ))}
        </div>
        {verdicts.length > 0 ? (
          <p className="mt-3 text-[11px] text-muted-foreground/80">
            <span className="font-medium">
              {(
                t("budget_same_point_vs_median") || "vs {{n}}-year median"
              ).replace("{{n}}", String(prior.length))}
              :
            </span>{" "}
            {verdicts.join(" · ")}
          </p>
        ) : null}
        <p className="mt-2 text-[11px] text-muted-foreground/80">
          {t("budget_same_point_caption") ||
            "Cumulative execution at the same calendar month, fiscal year over fiscal year. Plan share uses the annual budget law plan; nominal deltas are not inflation-adjusted."}
        </p>
      </CardContent>
    </Card>
  );
};
