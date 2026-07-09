// Plan-vs-actual execution pace — replaces НЗОК's static B1 PDFs with a live
// cumulative curve: how fast the fund is actually spending (form B1, cumulative
// YTD) against an even-pace draw-down of the annual budget-law plan. The gap
// between the two lines is whether the fund is running ahead of or behind budget
// — a read no НЗОК report offers and the single-year competitor can't show.
// Pure from the monthly execution points for one fiscal year + the plan total.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatEurCompact } from "@/lib/currency";
import { monthYearLabel } from "@/lib/monthNames";
import { tooltipSurfaceCompactClass } from "@/components/ui/tooltipSurface";
import type { NzokExecutionPoint } from "@/data/budget/types";

type Row = {
  month: number;
  label: string;
  actual: number | null;
  plan: number;
};

type TooltipPayload = {
  active?: boolean;
  payload?: { payload: Row }[];
};

export const NzokExecutionPaceChart: FC<{
  fiscalYear: number;
  points: NzokExecutionPoint[]; // this year's months, ascending
  planTotalEur: number;
}> = ({ fiscalYear, points, planTotalEur }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const eur = (v: number) => formatEurCompact(v, lang);

  const rows = useMemo<Row[]>(() => {
    const byMonth = new Map(
      points.map((p) => [p.month, p.expenditureEur ?? null]),
    );
    return Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      return {
        month,
        label: monthYearLabel(month, fiscalYear, lang),
        actual: byMonth.get(month) ?? null,
        // Even-pace plan: the annual budget drawn down linearly by month.
        plan: (planTotalEur * month) / 12,
      };
    });
  }, [points, fiscalYear, planTotalEur, lang]);

  // Latest month with an actual — the pace verdict is measured there.
  const latest = useMemo(() => {
    const withActual = points.filter((p) => p.expenditureEur != null);
    if (withActual.length === 0) return null;
    const last = withActual[withActual.length - 1];
    const evenPace = (planTotalEur * last.month) / 12;
    const paceDelta =
      evenPace > 0 ? (last.expenditureEur as number) / evenPace - 1 : 0;
    return {
      month: last.month,
      actual: last.expenditureEur as number,
      paceDelta,
    };
  }, [points, planTotalEur]);

  if (points.length < 2 || planTotalEur <= 0) return null;

  const ChartTooltip: FC<TooltipPayload> = ({ active, payload }) => {
    if (!active || !payload?.[0]) return null;
    const r = payload[0].payload;
    return (
      <div className={tooltipSurfaceCompactClass}>
        <div className="font-semibold">{r.label}</div>
        {r.actual != null && (
          <div className="tabular-nums">
            {bg ? "изпълнено" : "actual"}: {eur(r.actual)}
          </div>
        )}
        <div className="tabular-nums text-muted-foreground">
          {bg ? "равномерен план" : "even-pace plan"}: {eur(r.plan)}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
        <span className="text-muted-foreground">
          {bg
            ? `Темп на изпълнение ${fiscalYear}`
            : `Execution pace ${fiscalYear}`}
        </span>
        {latest && (
          <span className="tabular-nums">
            <span
              className={`font-semibold ${
                latest.paceDelta > 0.02
                  ? "text-rose-600 dark:text-rose-400"
                  : latest.paceDelta < -0.02
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground"
              }`}
            >
              {latest.paceDelta >= 0 ? "+" : ""}
              {(latest.paceDelta * 100).toLocaleString(lang, {
                maximumFractionDigits: 1,
              })}
              %
            </span>{" "}
            <span className="text-muted-foreground">
              {bg
                ? latest.paceDelta >= 0
                  ? "над равномерния темп"
                  : "под равномерния темп"
                : latest.paceDelta >= 0
                  ? "above even pace"
                  : "below even pace"}
            </span>
          </span>
        )}
      </div>
      <div className="h-[150px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={rows}
            margin={{ top: 6, right: 8, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              opacity={0.15}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 9 }}
              tickLine={false}
              axisLine={false}
              minTickGap={20}
            />
            <YAxis
              tick={{ fontSize: 9 }}
              tickLine={false}
              axisLine={false}
              width={38}
              tickFormatter={(v: number) => eur(v)}
            />
            <Tooltip content={<ChartTooltip />} />
            {/* Even-pace plan — the reference the actual is judged against. */}
            <Line
              type="linear"
              dataKey="plan"
              stroke="rgb(148 163 184)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              isAnimationActive={false}
            />
            {/* Actual cumulative execution. */}
            <Line
              type="monotone"
              dataKey="actual"
              stroke="rgb(13 148 136)"
              strokeWidth={2.5}
              dot={{ r: 2 }}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground/80">
        {bg
          ? "Плътна линия: касово изпълнение (форма B1, натрупано). Пунктир: равномерно усвояване на годишния бюджет по месеци."
          : "Solid: cash execution (form B1, cumulative). Dashed: an even monthly draw-down of the annual budget."}
      </p>
    </div>
  );
};
