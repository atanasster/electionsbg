import { FC, useMemo } from "react";
import {
  Line,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Legend,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { tooltipSurfaceCompactClass } from "@/components/ui/tooltipSurface";
import type { CohesionSeriesPoint } from "@/data/parliament/votes/types";

type Props = {
  series: CohesionSeriesPoint[];
  // Only these party-shorts are charted. Order also determines stroke order
  // (and thus legend order).
  selected: string[];
  colorFor: (partyShort: string) => string;
  labelFor: (partyShort: string) => string;
  className?: string;
};

type Row = { date: string } & Record<string, number | string>;

const Tip: FC<{
  active?: boolean;
  payload?: {
    name: string;
    value: number;
    color: string;
  }[];
  label?: string;
  labelFor: (s: string) => string;
}> = ({ active, payload, label, labelFor }) => {
  if (!active || !payload?.length) return null;
  const sorted = [...payload].sort((a, b) => b.value - a.value);
  return (
    <div className={cn("z-50 overflow-hidden", tooltipSurfaceCompactClass)}>
      <div className="text-muted-foreground text-xs text-center pb-1.5">
        {label}
      </div>
      <div className="flex flex-col gap-0.5">
        {sorted.map((p) => (
          <div className="flex items-center gap-2 text-xs" key={p.name}>
            <span
              className="inline-block w-2 h-2 rounded-sm shrink-0"
              style={{ backgroundColor: p.color }}
            />
            <span className="truncate flex-1">{labelFor(p.name)}</span>
            <span className="font-semibold tabular-nums">
              {(p.value * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const CohesionTrendChart: FC<Props> = ({
  series,
  selected,
  colorFor,
  labelFor,
  className,
}) => {
  const { t } = useTranslation();

  // Pivot from long-form series (one row per (date, party)) to wide-form
  // (one row per date with each selected party as a column). Recharts'
  // multi-line API consumes the wide form.
  const rows: Row[] = useMemo(() => {
    const sel = new Set(selected);
    const byDate = new Map<string, Row>();
    for (const p of series) {
      if (!sel.has(p.partyShort)) continue;
      const row = byDate.get(p.date) ?? ({ date: p.date } as Row);
      row[p.partyShort] = p.cohesion;
      byDate.set(p.date, row);
    }
    return [...byDate.values()].sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    );
  }, [series, selected]);

  if (rows.length === 0) return null;

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart
          data={rows}
          margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            // Scale to the observed range with a 2pp pad on each side and
            // 1pp snapping. A hard [0, 1] domain wastes the bottom 80% of
            // the chart because nearly every parliamentary group votes
            // together >85% of the time, so contrast between groups is the
            // signal — not absolute height.
            domain={[
              (dataMin: number) =>
                Math.max(0, Math.floor((dataMin - 0.02) * 100) / 100),
              (dataMax: number) =>
                Math.min(1, Math.ceil((dataMax + 0.02) * 100) / 100),
            ]}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip content={<Tip labelFor={labelFor} />} />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            formatter={(value: string) => labelFor(value)}
          />
          {selected.map((party) => (
            <Line
              key={party}
              type="monotone"
              dataKey={party}
              stroke={colorFor(party)}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls
              name={party}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="text-[10px] text-muted-foreground mt-1">
        {t("cohesion_chart_y_hint") ||
          "Y axis: per-session mean cohesion (1.0 = unanimous). Lines connect dates the group voted on at least one item."}
      </div>
    </div>
  );
};
