// Full trend chart for the КЗП "Колко струва" basket index (baseline = 100 on
// euro-changeover day). Follows the app's canonical Recharts recipe (faint 3-3
// grid, axis-lite ticks, custom popover tooltip, monotone line) — the same
// idiom as BudgetTrendTile / the macro tiles — so the Consumption view reads
// consistently with the rest of the site.
//
// The daily basket is noisy (recomputed each day from whichever stores
// reported), so we plot a 7-day trailing average as the primary trend line and
// keep the raw daily series as a faint context line beneath it. The dashed
// reference line at 100 marks the euro-day basket, so "above/below the line"
// reads as "more/less expensive than at the changeover" at a glance.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  type PricePoint,
  fmtPct,
  fmtPriceDate,
  movingAverage,
} from "@/data/prices/usePrices";
import { tooltipSurfaceClass } from "@/components/ui/tooltipSurface";

interface Props {
  series: PricePoint[];
  height?: number;
  smoothWindow?: number;
}

interface Datum {
  d: string;
  v: number; // raw daily basket index (baseline 100)
  avg: number; // trailing-average trend
}

// Prices convention: cheaper than the euro-day basket reads green, dearer reads
// red (matches priceChangeColor). Recharts strokes take a hex, not a class, so
// pick the semantic hue from the latest smoothed level.
const DOWN = "#059669"; // emerald — basket below 100 (cheaper)
const UP = "#e11d48"; // rose — basket above 100 (dearer)
const FLAT = "#64748b";

export const PriceIndexTrendChart: FC<Props> = ({
  series,
  height = 220,
  smoothWindow = 7,
}) => {
  const { i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const T = (bg: string, en: string) => (lang === "bg" ? bg : en);

  const { data, color, domain } = useMemo(() => {
    const avg = movingAverage(series, smoothWindow);
    const rows: Datum[] = series.map((p, i) => ({
      d: p.d,
      v: p.v,
      avg: avg[i].v,
    }));
    const last = avg[avg.length - 1]?.v ?? 100;
    const hue = last < 99.95 ? DOWN : last > 100.05 ? UP : FLAT;
    // Keep 100 in view (the baseline is the whole point) with a small pad.
    let lo = 100;
    let hi = 100;
    for (const r of rows) {
      lo = Math.min(lo, r.v, r.avg);
      hi = Math.max(hi, r.v, r.avg);
    }
    const pad = Math.max(0.4, (hi - lo) * 0.12);
    return {
      data: rows,
      color: hue,
      domain: [
        Math.floor((lo - pad) * 10) / 10,
        Math.ceil((hi + pad) * 10) / 10,
      ] as [number, number],
    };
  }, [series, smoothWindow]);

  if (series.length < 2) return null;

  const fmtDateTick = (d: string) =>
    new Date(d).toLocaleDateString(lang === "bg" ? "bg-BG" : "en-US", {
      day: "numeric",
      month: "short",
    });

  const TrendTooltip: FC<{
    active?: boolean;
    payload?: Array<{ payload: Datum }>;
  }> = ({ active, payload }) => {
    if (!active || !payload?.[0]) return null;
    const p = payload[0].payload;
    const change = p.v / 100 - 1;
    const changeCls =
      change > 0.0001
        ? "text-red-600 dark:text-red-400"
        : change < -0.0001
          ? "text-green-600 dark:text-green-400"
          : "text-muted-foreground";
    return (
      <div className={`${tooltipSurfaceClass} px-2 py-1.5 text-xs space-y-0.5`}>
        <div className="font-semibold">{fmtPriceDate(p.d, lang)}</div>
        <div className="tabular-nums">
          {T("кошница", "basket")}: {p.v.toFixed(2)}
          <span className={`ml-1 ${changeCls}`}>({fmtPct(change)})</span>
        </div>
      </div>
    );
  };

  return (
    <div style={{ height, width: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            className="stroke-border"
          />
          <XAxis
            dataKey="d"
            tickFormatter={fmtDateTick}
            tickLine={false}
            axisLine={false}
            fontSize={11}
            minTickGap={44}
            interval="preserveStartEnd"
            className="fill-muted-foreground"
          />
          <YAxis
            domain={domain}
            tickFormatter={(v: number) => fmtPct(v / 100 - 1, 0)}
            tickLine={false}
            axisLine={false}
            fontSize={11}
            width={44}
            className="fill-muted-foreground"
          />
          <Tooltip
            content={<TrendTooltip />}
            cursor={{ stroke: "var(--border)" }}
          />
          {/* Euro-day baseline (index = 100 = 0% on the axis). The Y axis is
              already labelled "% vs baseline", so the line needs no caption —
              a label here just overlaps the data on narrow (mobile) widths. */}
          <ReferenceLine
            y={100}
            className="stroke-border"
            strokeDasharray="4 3"
          />
          {/* Raw daily basket — faint context behind the trend. */}
          <Line
            dataKey="v"
            stroke={color}
            strokeWidth={1}
            strokeOpacity={0.25}
            dot={false}
            isAnimationActive={false}
            legendType="none"
          />
          {/* 7-day trailing average — the primary, de-squiggled trend. */}
          <Line
            type="monotone"
            dataKey="avg"
            stroke={color}
            strokeWidth={2.25}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};
