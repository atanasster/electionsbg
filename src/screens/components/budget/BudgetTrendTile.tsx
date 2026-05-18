// Monthly КФП execution trend. Revenue + expenditure as lines, balance as
// bars, one point per published monthly snapshot. The egov feed publishes
// cumulative year-to-date execution, so the series ramps up within each
// fiscal year and resets each January — the caption says so.
//
// For the in-progress fiscal year, dashed projection lines extend past the
// last actual month through December, scaled by the prior complete year's
// monthly cumulative shape: ratio = actualAtLatestMonth / priorAtLatestMonth,
// then projectedAtMonth = priorAtMonth × ratio. Same formula as the headline
// projection in scripts/budget/kfp.ts so the December endpoint matches the
// in-progress card. Requires the prior FY to be complete AND to have a
// snapshot at the same calendar month as the current latest — falls back
// silently to actuals-only otherwise.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { LineChart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import type { KfpObservation } from "@/data/budget/types";

// Curated lifetime markers — events with a clear, dateable fiscal-execution
// implication. Keep the list tight (≤ 10 entries lifetime) so the chart stays
// a chart, not a timeline. Periods must match the chart's "YYYY-MM" tick
// strings exactly or the ReferenceLine renders off-axis.
const BUDGET_EVENTS: Array<{
  period: string;
  labelBg: string;
  labelEn: string;
}> = [
  { period: "2020-03", labelBg: "COVID", labelEn: "COVID" },
  { period: "2022-02", labelBg: "Война", labelEn: "Ukraine war" },
  { period: "2024-06", labelBg: "Избори", labelEn: "Election" },
  { period: "2024-10", labelBg: "Избори", labelEn: "Election" },
  { period: "2026-01", labelBg: "Еврозона", labelEn: "Eurozone" },
  { period: "2026-04", labelBg: "Избори", labelEn: "Election" },
];

const compactEur = (v: number): string => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
  if (abs >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v}`;
};

interface ChartDatum {
  period: string;
  revenue: number | null;
  expenditure: number | null;
  // Combined balance for the single bar series — actual on past months,
  // projected on future months, distinguished by `isProjected` so the cell
  // can dim the projected slice.
  balanceBar: number | null;
  // Line projection series — null on actual months, populated for projected
  // months PLUS the join month (so the dashed line connects to the last
  // solid line point without a visible gap).
  revenueProj: number | null;
  expenditureProj: number | null;
  isProjected: boolean;
}

const fyOf = (period: string): number => parseInt(period.slice(0, 4), 10);
const monthOf = (period: string): number => parseInt(period.slice(5, 7), 10);

interface MonthlyValues {
  revenue: number | null;
  expenditure: number | null;
  euContribution: number | null;
  balance: number | null;
}

// Index a flat observation list by [fy, month] → series values. Projection
// reads from this on prior-year months the in-progress year hasn't reached.
const indexByFyMonth = (
  observations: KfpObservation[],
): Map<string, MonthlyValues> => {
  const out = new Map<string, MonthlyValues>();
  const key = (fy: number, m: number): string => `${fy}-${m}`;
  for (const o of observations) {
    const k = key(o.fiscalYear, monthOf(o.period));
    let v = out.get(k);
    if (!v) {
      v = {
        revenue: null,
        expenditure: null,
        euContribution: null,
        balance: null,
      };
      out.set(k, v);
    }
    const amt = o.executed.amountEur;
    if (o.series === "revenue") v.revenue = amt;
    else if (o.series === "expenditure") v.expenditure = amt;
    else if (o.series === "euContribution") v.euContribution = amt;
    else if (o.series === "balance") v.balance = amt;
  }
  return out;
};

const emptyDatum = (period: string, isProjected: boolean): ChartDatum => ({
  period,
  revenue: null,
  expenditure: null,
  balanceBar: null,
  revenueProj: null,
  expenditureProj: null,
  isProjected,
});

const buildData = (
  observations: KfpObservation[],
  allObservations: KfpObservation[],
): ChartDatum[] => {
  const byPeriod = new Map<string, ChartDatum>();
  for (const o of observations) {
    let d = byPeriod.get(o.period);
    if (!d) {
      d = emptyDatum(o.period, false);
      byPeriod.set(o.period, d);
    }
    const amt = o.executed.amountEur;
    if (o.series === "revenue") d.revenue = amt;
    else if (o.series === "expenditure") d.expenditure = amt;
    else if (o.series === "balance") d.balanceBar = amt;
  }
  const sorted = [...byPeriod.values()].sort((a, b) =>
    a.period.localeCompare(b.period),
  );
  if (sorted.length === 0) return sorted;

  // Determine in-progress FY from the latest displayed point. If it's already
  // at month 12, the year is complete — nothing to project.
  const last = sorted[sorted.length - 1];
  const currentFy = fyOf(last.period);
  const currentLatestMonth = monthOf(last.period);
  if (currentLatestMonth >= 12) return sorted;

  // Anchor: prior FY at the same calendar month + at December. Without both
  // we have no seasonal scale (same constraint the headline projection uses).
  const idx = indexByFyMonth(allObservations);
  const priorFy = currentFy - 1;
  const priorAtLatest = idx.get(`${priorFy}-${currentLatestMonth}`);
  const priorAtDec = idx.get(`${priorFy}-12`);
  if (!priorAtLatest || !priorAtDec) return sorted;

  // Per-series ratio. Each scales independently — revenue and expenditure
  // have different seasonal shapes (revenue is corporate-tax-backloaded;
  // expenditure runs more linearly). Balance is the residual: project rev,
  // exp, and EU contribution separately, then balance = rev − exp − EU.
  const ratio = (
    actual: number | null,
    prior: number | null,
  ): number | null => {
    if (actual == null || prior == null || prior === 0) return null;
    return actual / prior;
  };
  const ratioRev = ratio(last.revenue, priorAtLatest.revenue);
  const ratioExp = ratio(last.expenditure, priorAtLatest.expenditure);
  // EU contribution isn't displayed but feeds the balance projection. Use
  // ratio=1 if either side is missing, since EU contribution is small enough
  // that a stale prior estimate barely moves the balance bar.
  const currentEu = idx.get(
    `${currentFy}-${currentLatestMonth}`,
  )?.euContribution;
  const ratioEu = ratio(currentEu ?? null, priorAtLatest.euContribution) ?? 1;

  // Connect the dashed line at the last actual point: copy line actuals into
  // the projection keys for that single month so Recharts draws an unbroken
  // path from solid → dashed. NOT for the balance bar — a bar is per-month
  // discrete, so painting both `balance` and `balanceProj` here would render
  // two stacked rects at the join (visible as a doubled, darker bar).
  last.revenueProj = last.revenue;
  last.expenditureProj = last.expenditure;

  for (let m = currentLatestMonth + 1; m <= 12; m++) {
    const priorMonth = idx.get(`${priorFy}-${m}`);
    if (!priorMonth) continue;
    const period = `${currentFy}-${String(m).padStart(2, "0")}`;
    const projRev =
      ratioRev != null && priorMonth.revenue != null
        ? Math.round(priorMonth.revenue * ratioRev)
        : null;
    const projExp =
      ratioExp != null && priorMonth.expenditure != null
        ? Math.round(priorMonth.expenditure * ratioExp)
        : null;
    const projEu =
      priorMonth.euContribution != null
        ? Math.round(priorMonth.euContribution * ratioEu)
        : 0;
    const projBal =
      projRev != null && projExp != null ? projRev - projExp - projEu : null;
    const datum = emptyDatum(period, true);
    datum.revenueProj = projRev;
    datum.expenditureProj = projExp;
    datum.balanceBar = projBal;
    sorted.push(datum);
  }

  return sorted;
};

const ChartTooltip: FC<{
  active?: boolean;
  payload?: Array<{ payload: ChartDatum }>;
}> = ({ active, payload }) => {
  const { t } = useTranslation();
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  const projTag = d.isProjected ? (
    <span className="ml-1 text-[10px] uppercase tracking-wide text-amber-600">
      {t("budget_mode_projected") || "projected"}
    </span>
  ) : null;
  const rev = d.isProjected ? d.revenueProj : d.revenue;
  const exp = d.isProjected ? d.expenditureProj : d.expenditure;
  const bal = d.balanceBar;
  return (
    <div className="rounded-md border bg-popover px-2 py-1.5 text-popover-foreground shadow-sm text-xs space-y-0.5">
      <div className="font-semibold">
        {d.period}
        {projTag}
      </div>
      <div className="tabular-nums text-emerald-600">
        {t("budget_series_revenue") || "Revenue"}:{" "}
        {rev != null ? formatEur(rev) : "—"}
      </div>
      <div className="tabular-nums text-rose-600">
        {t("budget_series_expenditure") || "Expenditure"}:{" "}
        {exp != null ? formatEur(exp) : "—"}
      </div>
      <div className="tabular-nums text-muted-foreground">
        {t("budget_series_balance") || "Balance"}:{" "}
        {bal != null ? formatEur(bal) : "—"}
      </div>
    </div>
  );
};

export const BudgetTrendTile: FC<{
  observations: KfpObservation[];
  allObservations: KfpObservation[];
}> = ({ observations, allObservations }) => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const data = buildData(observations, allObservations);
  const visibleEvents = useMemo(() => {
    const periods = new Set(data.map((d) => d.period));
    return BUDGET_EVENTS.filter((e) => periods.has(e.period));
  }, [data]);
  if (data.length === 0) return null;
  const hasProjection = data.some((d) => d.isProjected);

  return (
    <Card id="budget-trend" className="my-4 scroll-mt-20" data-og="budget-trend">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <LineChart className="h-4 w-4" />
          {t("budget_trend_title") || "Execution trend"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div style={{ height: 280, width: "100%" }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{
                top: visibleEvents.length > 0 ? 24 : 8,
                right: 16,
                bottom: 0,
                left: 0,
              }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                className="stroke-border"
              />
              <XAxis
                dataKey="period"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                className="fill-muted-foreground"
              />
              <YAxis
                tickFormatter={compactEur}
                tickLine={false}
                axisLine={false}
                fontSize={11}
                className="fill-muted-foreground"
                width={56}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ fill: "var(--muted)", opacity: 0.3 }}
              />
              <ReferenceLine y={0} className="stroke-border" />
              {/* Narrative markers — vertical dashed line + a top label.
                  Labels stagger between two heights so adjacent events (e.g.
                  back-to-back snap elections in 2024) don't collide on
                  narrow viewports. Lines stay subtle so the data series
                  remain primary. */}
              {visibleEvents.map((e, i) => (
                <ReferenceLine
                  key={e.period}
                  x={e.period}
                  stroke="#94a3b8"
                  strokeDasharray="2 3"
                  ifOverflow="extendDomain"
                  label={{
                    value: lang === "bg" ? e.labelBg : e.labelEn,
                    position: i % 2 === 0 ? "top" : "insideTop",
                    fontSize: 9,
                    fill: "#64748b",
                  }}
                />
              ))}
              {/* Balance bars: deficit (negative) in rose, surplus in
                  emerald. Same hues as the budget-flow графика's
                  COLOR_DEFICIT / COLOR_SURPLUS so the metaphor stays
                  consistent across tiles. ONE Bar series so Recharts
                  centers each rect on its X tick — two parallel Bar series
                  would group them side-by-side and shift the actuals off
                  the line dots. The combined `balanceBar` carries actual
                  values for past months and projected values for future
                  months; per-cell opacity dims the projected slice. */}
              <Bar dataKey="balanceBar" radius={[2, 2, 0, 0]}>
                {data.map((d, i) => (
                  <Cell
                    key={`bal-${i}`}
                    fill={(d.balanceBar ?? 0) < 0 ? "#fb7185" : "#34d399"}
                    fillOpacity={d.isProjected ? 0.4 : 1}
                  />
                ))}
              </Bar>
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="#059669"
                strokeWidth={2}
                dot={{ r: 2.5, fill: "#059669" }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="expenditure"
                stroke="#e11d48"
                strokeWidth={2}
                dot={{ r: 2.5, fill: "#e11d48" }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="revenueProj"
                stroke="#059669"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={{ r: 2, fill: "#059669", fillOpacity: 0.6 }}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
                legendType="none"
              />
              <Line
                type="monotone"
                dataKey="expenditureProj"
                stroke="#e11d48"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={{ r: 2, fill: "#e11d48", fillOpacity: 0.6 }}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
                legendType="none"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[11px] text-muted-foreground/80 mt-2">
          {hasProjection ? (
            <>
              {t("budget_trend_caption_projected") ||
                "Cumulative execution within each fiscal year — figures reset each January. Dashed lines extend the in-progress year through December using the prior year's seasonal pattern."}
            </>
          ) : (
            t("budget_trend_caption") ||
            "Cumulative execution within each fiscal year — figures reset each January."
          )}
        </p>
      </CardContent>
    </Card>
  );
};
