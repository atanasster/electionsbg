// One pair of groups, across every parliament we hold roll-calls for.
//
// Two things about this chart are not decoration:
//
// `connectNulls` is OFF. A missing parliament means the pair did not exist in it — ПП and
// ДБ sat as ONE group in the 49th and 50th, so the ПП↔ДБ pair genuinely has nothing to say
// about those two years. Connecting across the gap would draw a line through a period in
// which one of the two endpoints was not in the chamber.
//
// The zero line is always in frame. This is a cosine in [-1, 1], so the SIGN is the
// headline — „voting together" and „voting against each other" are opposite claims, and a
// domain fitted tightly to a series that happens to sit entirely above zero would show the
// same shape for both.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { tooltipSurfaceCompactClass } from "@/components/ui/tooltipSurface";
import { nsOrdinal } from "@/data/parliament/nsOrdinal";
import type { PairSeries } from "@/data/parliament/votes/partyPairs";

type Row = { ns: string; score: number | null; via?: string };

const Tip: FC<{
  active?: boolean;
  payload?: { payload: Row }[];
  nsLabel: (ns: string) => string;
}> = ({ active, payload, nsLabel }) => {
  const { t } = useTranslation();
  const row = payload?.[0]?.payload;
  if (!active || !row || row.score === null) return null;
  return (
    <div className={cn("z-50 overflow-hidden", tooltipSurfaceCompactClass)}>
      <div className="text-muted-foreground text-xs pb-1">
        {nsLabel(row.ns)}
      </div>
      <div className="font-semibold tabular-nums text-sm">
        {Math.round(row.score * 100)}%
      </div>
      {row.via && (
        <div className="text-muted-foreground text-[11px] pt-0.5">
          {t("corr_history_via", { group: row.via })}
        </div>
      )}
    </div>
  );
};

// Hollow for a point that came from a differently-named row — the coalition its group sat
// in (ПП-ДБ), or the name it went by then (ДПС - НН). Filled and hollow are the same
// measure but not the same observation, and a chart that drew them identically would
// present an editorial join as a plain continuous series.
type DotProps = { cx?: number; cy?: number; payload?: Row };
const ArcDot: FC<DotProps> = ({ cx, cy, payload }) => {
  // recharts calls the renderer for gap points too, and a dot drawn at a null score is a
  // dot floating over a parliament the pair did not exist in.
  if (cx === undefined || cy === undefined || payload?.score == null) {
    return null;
  }
  const joined = Boolean(payload.via);
  return (
    <circle
      cx={cx}
      cy={cy}
      r={joined ? 4 : 3}
      fill={joined ? "hsl(var(--card))" : "hsl(var(--primary))"}
      stroke="hsl(var(--primary))"
      strokeWidth={joined ? 2 : 1}
    />
  );
};

export const PairCorrelationArcChart: FC<{
  pair: PairSeries;
  /** Every parliament in the corpus — the x-axis. Passing only the pair's own points would
   *  hide the gap by closing it up. */
  parliaments: string[];
  /** The parliament the page is currently scoped to, marked on the axis. */
  currentNs: string | null;
  className?: string;
}> = ({ pair, parliaments, currentNs, className }) => {
  const { t, i18n } = useTranslation();
  const nsLabel = (ns: string) => nsOrdinal(ns, i18n.language);

  const rows: Row[] = useMemo(() => {
    const byNs = new Map(pair.points.map((p) => [p.ns, p]));
    return parliaments.map((ns) => {
      const p = byNs.get(ns);
      return { ns, score: p?.score ?? null, ...(p?.via ? { via: p.via } : {}) };
    });
  }, [pair, parliaments]);

  const joined = pair.points.some((p) => p.via);

  // Snapped to quarters so the ticks read -50/-25/0/25/50 rather than recharts' own
  // -40/-15/10/50 over a raw data range. Zero is always inside the domain (see header).
  const { lo, hi, ticks } = useMemo(() => {
    const vals = pair.points.map((p) => p.score);
    const step = 0.25;
    const min = Math.max(
      -1,
      Math.floor((Math.min(0, ...vals) - 0.02) / step) * step,
    );
    const max = Math.min(
      1,
      Math.ceil((Math.max(0, ...vals) + 0.02) / step) * step,
    );
    const out: number[] = [];
    for (let v = min; v <= max + 1e-9; v += step)
      out.push(Number(v.toFixed(2)));
    return { lo: min, hi: max, ticks: out };
  }, [pair]);

  if (pair.points.length === 0) return null;

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart
          data={rows}
          margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="ns"
            tickFormatter={nsLabel}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
          />
          <YAxis
            domain={[lo, hi]}
            ticks={ticks}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <ReferenceLine
            y={0}
            stroke="hsl(var(--muted-foreground))"
            strokeOpacity={0.5}
          />
          {currentNs && rows.some((r) => r.ns === currentNs) && (
            <ReferenceLine
              x={currentNs}
              stroke="hsl(var(--primary))"
              strokeDasharray="4 3"
              strokeOpacity={0.5}
            />
          )}
          <Tooltip content={<Tip nsLabel={nsLabel} />} />
          <Line
            type="monotone"
            dataKey="score"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={<ArcDot />}
            activeDot={{ r: 5 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground mt-1">
        {t("corr_history_chart_note")}
        {joined ? ` ${t("corr_history_joined_note")}` : ""}
      </p>
    </div>
  );
};
