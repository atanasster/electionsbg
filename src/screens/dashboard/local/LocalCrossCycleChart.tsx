// Presentational cross-cycle council-share chart. Renders a `CrossCycleData`
// (party council vote share per local cycle) as a Recharts multi-line chart +
// a legend with each party's latest share, wrapped in a StatCard. Shared by
// the national tile (LocalCrossCycleTile) and the per-município tile
// (LocalCouncilTrendsTile) so both draw identically. Self-hides when there
// aren't at least two cycles of usable signal.

import { FC, ReactNode, useMemo } from "react";
import { TrendingUp } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CrossCycleData } from "@/data/local/crossCycleShape";
import { tooltipSurfaceCompactClass } from "@/components/ui/tooltipSurface";
import { cn } from "@/lib/utils";
import { StatCard } from "../StatCard";

type TipEntry = {
  name?: string;
  value?: number;
  color?: string;
  dataKey?: string | number;
};

const ChartTooltip: FC<{
  active?: boolean;
  payload?: TipEntry[];
  label?: string;
}> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const rows = payload
    .filter((p) => p.value != null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  if (!rows.length) return null;
  return (
    <div className={cn(tooltipSurfaceCompactClass, "z-50")}>
      <div className="text-muted-foreground text-center pb-1">{label}</div>
      <div className="flex flex-col gap-0.5">
        {rows.map((p) => (
          <div
            key={p.dataKey}
            className="flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                aria-hidden
                className="inline-block size-2 rounded-full shrink-0"
                style={{ backgroundColor: p.color }}
              />
              <span className="truncate">{p.name}</span>
            </div>
            <span className="tabular-nums font-semibold">
              {(p.value ?? 0).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

type Props = {
  data?: CrossCycleData;
  title: ReactNode;
  hint?: string;
  className?: string;
};

export const LocalCrossCycleChart: FC<Props> = ({
  data,
  title,
  hint,
  className,
}) => {
  const chart = useMemo(() => {
    if (!data || data.cyclesAsc.length < 2 || data.parties.length === 0)
      return null;
    const rawMax = Math.max(
      1,
      ...data.parties.flatMap((p) => p.points.map((pt) => pt.councilPct ?? 0)),
    );
    const yMax = Math.ceil(rawMax / 5) * 5;
    // Pivot to one row per cycle keyed by a synthetic series id (p0, p1, …) so
    // the dataKey never collides with a party canonicalId that carries a `:`.
    const rows = data.cyclesAsc.map((c, ci) => {
      const row: Record<string, string | number | null> = { year: c.year };
      data.parties.forEach((p, pi) => {
        row[`p${pi}`] = p.points[ci]?.councilPct ?? null;
      });
      return row;
    });
    return { yMax, rows };
  }, [data]);

  if (!chart || !data) return null;

  return (
    <StatCard
      className={className}
      label={
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          <span>{title}</span>
        </div>
      }
      hint={hint}
    >
      <div className="w-full h-[240px] mt-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chart.rows}
            margin={{ top: 14, right: 18, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              opacity={0.15}
            />
            <XAxis
              dataKey="year"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              interval={0}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={40}
              tickFormatter={(v) => `${v}%`}
              domain={[0, chart.yMax]}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: "hsl(var(--border))" }}
            />
            {data.parties.map((p, pi) => (
              <Line
                key={p.canonicalId}
                dataKey={`p${pi}`}
                name={p.displayName}
                type="monotone"
                stroke={p.color}
                strokeWidth={2}
                dot={{ r: 2.5, fill: p.color, strokeWidth: 0 }}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Legend: party + latest share */}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {data.parties.map((p) => (
          <li
            key={p.canonicalId}
            className="flex items-center gap-1.5 text-xs min-w-0"
          >
            <span
              aria-hidden
              className="inline-block size-2 rounded-full ring-1 ring-border shrink-0"
              style={{ backgroundColor: p.color }}
            />
            <span className="truncate" title={p.displayName}>
              {p.displayName}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {p.latestCouncilPct.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </StatCard>
  );
};
