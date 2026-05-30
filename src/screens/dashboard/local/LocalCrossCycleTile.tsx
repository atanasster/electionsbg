// Cross-cycle trends: council vote share per party across the regular local
// cycles (2011 → 2023). Compact inline-SVG multi-line chart (no charting dep)
// + a legend with each party's latest share. Council share is the proportional
// party-preference signal; mayoralties are winner-take-all.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TrendingUp } from "lucide-react";
import { useLocalCrossCycle } from "@/data/local/useLocalCrossCycle";
import { StatCard } from "../StatCard";

const W = 640;
const H = 240;
const PAD = { t: 16, r: 12, b: 28, l: 32 };

export const LocalCrossCycleTile: FC = () => {
  const { t } = useTranslation();
  const { data } = useLocalCrossCycle(6);

  const chart = useMemo(() => {
    if (!data || data.cyclesAsc.length < 2 || data.parties.length === 0)
      return null;
    const n = data.cyclesAsc.length;
    const rawMax = Math.max(
      1,
      ...data.parties.flatMap((p) => p.points.map((pt) => pt.councilPct ?? 0)),
    );
    const yMax = Math.ceil(rawMax / 5) * 5;
    const xFor = (i: number) =>
      PAD.l + (i * (W - PAD.l - PAD.r)) / Math.max(1, n - 1);
    const yFor = (v: number) => H - PAD.b - (v / yMax) * (H - PAD.t - PAD.b);

    const series = data.parties.map((p) => {
      // Split into segments of consecutive non-null points so a party absent in
      // a cycle leaves a gap rather than a misleading straight line.
      const segments: { x: number; y: number }[][] = [];
      let cur: { x: number; y: number }[] = [];
      p.points.forEach((pt, i) => {
        if (pt.councilPct == null) {
          if (cur.length) segments.push(cur);
          cur = [];
        } else {
          cur.push({ x: xFor(i), y: yFor(pt.councilPct) });
        }
      });
      if (cur.length) segments.push(cur);
      return { party: p, segments };
    });

    const yTicks = [0, yMax / 2, yMax];
    return { n, yMax, xFor, yFor, series, yTicks };
  }, [data]);

  if (!chart || !data) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          <span>{t("local_trends_council_title")}</span>
        </div>
      }
      hint={t("local_trends_hint")}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
        role="img"
      >
        {/* y gridlines + labels */}
        {chart.yTicks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={chart.yFor(v)}
              y2={chart.yFor(v)}
              stroke="hsl(var(--border))"
              strokeWidth={1}
            />
            <text
              x={PAD.l - 6}
              y={chart.yFor(v) + 3}
              textAnchor="end"
              className="fill-muted-foreground"
              fontSize={10}
            >
              {v}%
            </text>
          </g>
        ))}
        {/* x labels (years) */}
        {data.cyclesAsc.map((c, i) => (
          <text
            key={c.cycle}
            x={chart.xFor(i)}
            y={H - 8}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={10}
          >
            {c.year}
          </text>
        ))}
        {/* one polyline per party */}
        {chart.series.map(({ party, segments }) =>
          segments.map((seg, si) => (
            <g key={`${party.canonicalId}-${si}`}>
              <polyline
                fill="none"
                stroke={party.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                points={seg.map((pt) => `${pt.x},${pt.y}`).join(" ")}
              />
              {seg.map((pt, pi) => (
                <circle
                  key={pi}
                  cx={pt.x}
                  cy={pt.y}
                  r={2.5}
                  fill={party.color}
                />
              ))}
            </g>
          )),
        )}
      </svg>

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
