// The КФП execution trend — revenue and expenditure as lines, the balance as
// bars, with a dashed projection to December on an unfinished year.
//
// Plan: docs/plans/budget-hub-v1.md T9.2. The pre-migration `/budget` led with
// this and the hub migration shipped fourteen pages without a single chart on
// any of them; the arithmetic lives in ./budgetTrend.ts so the legacy tile and
// this one cannot disagree about how the year ends.
//
// AN AXED CHART, not a sparkline. The repo's convention is explicit about it:
// a bare trend line with no scale invites a reader to size a movement they
// cannot measure. Both axes are labelled and the Y ticks carry their unit.

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
import { formatEur, formatEurSigned } from "@/lib/currency";
import {
  BUDGET_EVENTS,
  buildTrendData,
  type TrendDatum,
  type TrendPoint,
} from "./budgetTrend";

/** Y-axis ticks. Deliberately NOT `formatEurCompact`: that renders the locale's
 *  magnitude word („млрд.") which is too wide for a 56px gutter and wraps the
 *  axis. A tick is a scale marker, not a figure to quote — the tooltip and the
 *  table below carry the exact values. */
const tickEur = (v: number): string => {
  // SIGN OUTSIDE THE SYMBOL. The balance bars go negative, and the naive form
  // renders „€-4.0B" — the exact shape `currency.ts` documents as wrong, naming
  // a budget balance as the case it is wrong for. This page prints the same
  // figure as „−€1,9 млрд." thirty lines up.
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000)
    return `${sign}€${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}€${(abs / 1_000_000).toFixed(0)}M`;
  if (abs >= 1_000) return `${sign}€${(abs / 1_000).toFixed(0)}k`;
  return `${sign}€${abs}`;
};

const ChartTooltip: FC<{
  active?: boolean;
  payload?: Array<{ payload: TrendDatum }>;
}> = ({ active, payload }) => {
  const { t } = useTranslation();
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const rev = d.revenue ?? d.revenueProj;
  const exp = d.expenditure ?? d.expenditureProj;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-semibold tabular-nums">
        {d.period}
        {d.isProjected ? (
          <span className="ml-1.5 font-normal text-muted-foreground">
            {t("budget_trend_projected")}
          </span>
        ) : null}
      </div>
      {rev != null ? (
        <div className="mt-1 tabular-nums">
          <span className="text-muted-foreground">
            {t("budget_series_revenue")}:{" "}
          </span>
          {formatEur(rev)}
        </div>
      ) : null}
      {exp != null ? (
        <div className="tabular-nums">
          <span className="text-muted-foreground">
            {t("budget_series_expenditure")}:{" "}
          </span>
          {formatEur(exp)}
        </div>
      ) : null}
      {d.balanceBar != null ? (
        <div className="tabular-nums">
          <span className="text-muted-foreground">
            {t("budget_series_balance")}:{" "}
          </span>
          {/* The one figure here that can be negative — and the only one where
              the sign is the information. */}
          {formatEurSigned(d.balanceBar)}
        </div>
      ) : null}
    </div>
  );
};

export const BudgetTrendChart: FC<{
  /** The window to draw. */
  points: TrendPoint[];
  /** The whole corpus — the seasonal anchor is the PRIOR fiscal year, which is
   *  usually outside the drawn window. Pass the same array when they coincide. */
  allPoints?: TrendPoint[];
  className?: string;
}> = ({ points, allPoints, className }) => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";

  const data = useMemo(
    () => buildTrendData(points, allPoints ?? points),
    [points, allPoints],
  );

  // Only markers inside the drawn window. An event outside it would be pinned
  // to an axis end by `ifOverflow="extendDomain"` and label a month that is not
  // on screen.
  const events = useMemo(() => {
    const periods = new Set(data.map((d) => d.period));
    return BUDGET_EVENTS.filter((e) => periods.has(e.period));
  }, [data]);

  const projected = data.some((d) => d.isProjected);

  if (data.length < 2) return null;

  return (
    <div className={className}>
      <div style={{ height: 280, width: "100%" }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{
              top: events.length ? 24 : 8,
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
              tickFormatter={tickEur}
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
            {events.map((e, i) => (
              <ReferenceLine
                key={e.period}
                x={e.period}
                stroke="#94a3b8"
                strokeDasharray="2 3"
                ifOverflow="extendDomain"
                label={{
                  value: bg ? e.labelBg : e.labelEn,
                  // Staggered, so back-to-back events (the two 2024 snap
                  // elections) do not overprint on a narrow viewport.
                  position: i % 2 === 0 ? "top" : "insideTop",
                  fontSize: 9,
                  fill: "#64748b",
                }}
              />
            ))}
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
      {/* The two things a reader cannot infer from the picture: the series is
          cumulative and resets each January, and the dashed tail is arithmetic
          rather than a plan. */}
      <p className="mt-2 text-[11px] text-muted-foreground/80">
        {t("budget_trend_cumulative_note")}
        {projected ? ` ${t("budget_trend_projection_note")}` : ""}
      </p>
    </div>
  );
};
