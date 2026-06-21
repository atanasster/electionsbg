// Cross-cycle council-share BUBBLE chart (the local-elections analogue of the
// parliamentary BubbleTimeline / HistoricalTrendsTile). Renders a `CrossCycleData`
// as one bubble per party per local cycle: x = cycle, y = council vote share %,
// and the bubble AREA is proportional to the raw council votes that cycle. Faint
// threads connect each party's bubbles across cycles. Shared by the national
// tile, the per-município tile and the per-place (settlement/район) tile so they
// all draw identically. Self-hides under two cycles of usable signal.

import { FC, ReactNode, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import { CrossCycleData } from "@/data/local/crossCycleShape";
import { formatThousands } from "@/data/utils";
import { StatCard } from "../StatCard";

type Props = {
  data?: CrossCycleData;
  title: ReactNode;
  hint?: string;
  className?: string;
};

type Bubble = {
  partyIdx: number;
  name: string;
  color: string;
  cycleIdx: number;
  year: string;
  pct: number;
  votes: number;
};

const W = 1000;
const H = 240;
const MARGIN = { top: 12, right: 20, bottom: 34, left: 40 };
const innerW = W - MARGIN.left - MARGIN.right;
const innerH = H - MARGIN.top - MARGIN.bottom;
const X_PAD = 16;
const R_MIN = 3;
const R_MAX = 16;

export const LocalCrossCycleChart: FC<Props> = ({
  data,
  title,
  hint,
  className,
}) => {
  const [hover, setHover] = useState<Bubble | null>(null);

  const chart = useMemo(() => {
    if (!data || data.cyclesAsc.length < 2 || data.parties.length === 0)
      return null;
    const n = data.cyclesAsc.length;
    const bubbles: Bubble[] = [];
    let maxPct = 0;
    let maxVotes = 0;
    data.parties.forEach((p, pi) => {
      p.points.forEach((pt, ci) => {
        if (pt.councilPct == null) return;
        const votes = pt.votes ?? 0;
        bubbles.push({
          partyIdx: pi,
          name: p.displayName,
          color: p.color,
          cycleIdx: ci,
          year: pt.year,
          pct: pt.councilPct,
          votes,
        });
        if (pt.councilPct > maxPct) maxPct = pt.councilPct;
        if (votes > maxVotes) maxVotes = votes;
      });
    });
    if (bubbles.length === 0) return null;
    const yMax = Math.max(5, Math.ceil(maxPct / 5) * 5);

    const xScale = (i: number) =>
      n <= 1 ? innerW / 2 : X_PAD + (i * (innerW - 2 * X_PAD)) / (n - 1);
    const yScale = (pct: number) => innerH - (pct / yMax) * innerH;
    const rScale = (votes: number) =>
      maxVotes > 0
        ? R_MIN + Math.sqrt(votes / maxVotes) * (R_MAX - R_MIN)
        : R_MIN;

    // One thread per party connecting its visible bubbles (≥2).
    const threads = data.parties
      .map((p, pi) => ({
        color: p.color,
        pts: p.points
          .map((pt, ci) =>
            pt.councilPct == null
              ? null
              : { x: xScale(ci), y: yScale(pt.councilPct) },
          )
          .filter((v): v is { x: number; y: number } => v !== null),
        key: pi,
      }))
      .filter((t) => t.pts.length >= 2);

    const yTicks = [0, 10, 20, 30, 40, 50].filter((v) => v <= yMax);
    return { bubbles, threads, xScale, yScale, rScale, yTicks };
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
      <div className="relative w-full mt-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
          <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
            {/* Y grid + labels */}
            {chart.yTicks.map((v) => (
              <g key={v}>
                <line
                  x1={0}
                  y1={chart.yScale(v)}
                  x2={innerW}
                  y2={chart.yScale(v)}
                  stroke="currentColor"
                  strokeOpacity={0.08}
                />
                <text
                  x={-8}
                  y={chart.yScale(v)}
                  dy={4}
                  textAnchor="end"
                  className="fill-muted-foreground text-[9px]"
                >
                  {v}%
                </text>
              </g>
            ))}
            {/* X labels (years) */}
            {data.cyclesAsc.map((c, i) => (
              <g
                key={c.cycle}
                transform={`translate(${chart.xScale(i)}, ${innerH})`}
              >
                <line y1={0} y2={4} stroke="currentColor" strokeOpacity={0.3} />
                <text
                  y={16}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[9px] tabular-nums"
                >
                  {c.year}
                </text>
              </g>
            ))}
            {/* Threads (under bubbles) */}
            {chart.threads.map((t) => (
              <polyline
                key={t.key}
                fill="none"
                stroke={t.color}
                strokeWidth={1.5}
                strokeOpacity={0.3}
                strokeLinecap="round"
                strokeLinejoin="round"
                points={t.pts
                  .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
                  .join(" ")}
              />
            ))}
            {/* Bubbles */}
            {chart.bubbles.map((b, i) => {
              const isHover = hover === b;
              return (
                <circle
                  key={i}
                  cx={chart.xScale(b.cycleIdx)}
                  cy={chart.yScale(b.pct)}
                  r={chart.rScale(b.votes)}
                  fill={b.color}
                  fillOpacity={isHover ? 0.85 : 0.55}
                  stroke={b.color}
                  strokeWidth={isHover ? 2 : 1}
                  strokeOpacity={0.9}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHover(b)}
                  onMouseLeave={() => setHover((h) => (h === b ? null : h))}
                />
              );
            })}
          </g>
          {/* Hover tooltip */}
          {hover &&
            (() => {
              const bx = MARGIN.left + chart.xScale(hover.cycleIdx);
              const by = MARGIN.top + chart.yScale(hover.pct);
              const r = chart.rScale(hover.votes);
              const tw = 210;
              const th = 42;
              const below = by - r - 8 - th < 0;
              const tx = Math.max(tw / 2, Math.min(W - tw / 2, bx));
              const ty = below ? by + r + 8 : by - r - 8;
              const ry = below ? 0 : -th;
              return (
                <g transform={`translate(${tx}, ${ty})`} pointerEvents="none">
                  <rect
                    x={-tw / 2}
                    y={ry}
                    width={tw}
                    height={th}
                    rx={6}
                    style={{
                      fill: "hsl(var(--popover))",
                      stroke: "hsl(var(--border))",
                      strokeWidth: 1,
                    }}
                  />
                  <foreignObject x={-tw / 2} y={ry} width={tw} height={th}>
                    <div
                      className="text-popover-foreground px-2 py-1 text-center leading-tight"
                      style={{ fontSize: 10 }}
                    >
                      <div
                        className="font-semibold truncate"
                        title={hover.name}
                      >
                        {hover.name}
                      </div>
                      <div
                        className="text-muted-foreground mt-0.5 tabular-nums"
                        style={{ fontSize: 9 }}
                      >
                        {hover.year} · {hover.pct.toFixed(1)}%
                        {hover.votes > 0
                          ? ` · ${formatThousands(hover.votes)}`
                          : ""}
                      </div>
                    </div>
                  </foreignObject>
                </g>
              );
            })()}
        </svg>
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
