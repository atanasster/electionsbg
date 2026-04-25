import { FC, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ElectionInfo } from "@/data/dataTypes";
import { formatPct, formatThousands, localDate } from "@/data/utils";

type BubblePoint = {
  electionIdx: number; // 0..electionsCount-1, sorted oldest → newest
  electionName: string;
  partyNum: number;
  nickName: string;
  color?: string;
  totalVotes: number;
  pct: number;
};

type Props = {
  stats: ElectionInfo[];
  minPct?: number; // hide tiny parties to reduce clutter
  height?: number;
  colorFor?: (nickName: string) => string | undefined;
  // Returns a stable lineage ID for a nickName so bubbles belonging to the same
  // canonical party across elections can be threaded together with a line.
  lineageFor?: (nickName: string) => string | undefined;
};

const MARGIN = { top: 24, right: 24, bottom: 56, left: 48 };

export const BubbleTimeline: FC<Props> = ({
  stats,
  minPct = 0.5,
  height = 480,
  colorFor,
  lineageFor,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [hover, setHover] = useState<BubblePoint | null>(null);

  const { points, elections, maxPct, maxVotes } = useMemo(() => {
    const sorted = [...stats]
      .filter((e) => !!e.results?.votes?.length)
      .sort((a, b) => a.name.localeCompare(b.name));
    const electionList = sorted.map((e) => e.name);
    const ps: BubblePoint[] = [];
    let maxP = 0;
    let maxV = 0;
    sorted.forEach((e, idx) => {
      const total = e.results?.votes.reduce((s, v) => s + v.totalVotes, 0) ?? 0;
      e.results?.votes.forEach((v) => {
        if (!total || !v.totalVotes) return;
        const pct = (100 * v.totalVotes) / total;
        if (pct < minPct) return;
        ps.push({
          electionIdx: idx,
          electionName: e.name,
          partyNum: v.partyNum,
          nickName: v.nickName ?? `#${v.partyNum}`,
          totalVotes: v.totalVotes,
          pct,
        });
        if (pct > maxP) maxP = pct;
        if (v.totalVotes > maxV) maxV = v.totalVotes;
      });
    });
    return {
      points: ps,
      elections: electionList,
      maxPct: maxP,
      maxVotes: maxV,
    };
  }, [stats, minPct]);

  const W = 1000;
  const H = height;
  const innerW = W - MARGIN.left - MARGIN.right;
  const innerH = H - MARGIN.top - MARGIN.bottom;

  const xScale = (idx: number) =>
    elections.length <= 1
      ? innerW / 2
      : (idx * innerW) / (elections.length - 1);

  const yScale = (pct: number) => innerH - (pct / Math.max(maxPct, 1)) * innerH;

  // Bubble radius scales by sqrt(votes) so AREA is proportional to votes.
  const rScale = (votes: number) => {
    if (!maxVotes) return 4;
    const rMax = 28;
    const rMin = 4;
    const ratio = Math.sqrt(votes / maxVotes);
    return rMin + ratio * (rMax - rMin);
  };

  // Y-axis ticks at 0, 10, 20, 30, 40
  const yTicks = [0, 10, 20, 30, 40, 50].filter((v) => v <= Math.ceil(maxPct));

  // Group bubbles by lineage and produce one polyline per lineage that has
  // ≥2 visible bubbles. Skips lineages where lineageFor returns undefined.
  type LineagePolyline = {
    id: string;
    color: string;
    points: { x: number; y: number }[];
  };
  const lineages: LineagePolyline[] = [];
  if (lineageFor) {
    const grouped = new Map<string, BubblePoint[]>();
    points.forEach((p) => {
      const id = lineageFor(p.nickName);
      if (!id) return;
      const list = grouped.get(id) ?? [];
      list.push(p);
      grouped.set(id, list);
    });
    grouped.forEach((bubbles, id) => {
      if (bubbles.length < 2) return;
      const sorted = [...bubbles].sort((a, b) => a.electionIdx - b.electionIdx);
      const color =
        (colorFor && colorFor(sorted[sorted.length - 1].nickName)) ||
        sorted[sorted.length - 1].color ||
        "#888";
      lineages.push({
        id,
        color,
        points: sorted.map((p) => ({
          x: xScale(p.electionIdx),
          y: yScale(p.pct),
        })),
      });
    });
  }

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t("timeline_title")}
        className="w-full min-w-[720px]"
      >
        <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
          {/* Y grid */}
          {yTicks.map((v) => (
            <g key={v}>
              <line
                x1={0}
                y1={yScale(v)}
                x2={innerW}
                y2={yScale(v)}
                stroke="currentColor"
                strokeOpacity={0.08}
              />
              <text
                x={-8}
                y={yScale(v)}
                dy={4}
                textAnchor="end"
                className="text-xs fill-muted-foreground"
              >
                {v}%
              </text>
            </g>
          ))}

          {/* X axis labels */}
          {elections.map((name, idx) => (
            <g key={name} transform={`translate(${xScale(idx)}, ${innerH})`}>
              <line y1={0} y2={6} stroke="currentColor" strokeOpacity={0.3} />
              <text
                y={20}
                textAnchor="middle"
                className="text-xs fill-muted-foreground"
              >
                {localDate(name).slice(3)}
              </text>
              <text
                y={36}
                textAnchor="middle"
                className="text-[10px] fill-muted-foreground"
              >
                {localDate(name).slice(0, 2)}
              </text>
            </g>
          ))}

          {/* Lineage threads (drawn under bubbles) */}
          {lineages.map((l) => (
            <polyline
              key={l.id}
              fill="none"
              stroke={l.color}
              strokeWidth={1.5}
              strokeOpacity={0.35}
              strokeLinecap="round"
              strokeLinejoin="round"
              points={l.points
                .map((pt) => `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`)
                .join(" ")}
            />
          ))}

          {/* Bubbles */}
          {points.map((p, i) => {
            const isHovered = hover === p;
            const color =
              (colorFor && colorFor(p.nickName)) || p.color || "#888";
            return (
              <circle
                key={`${p.electionName}-${p.partyNum}-${i}`}
                cx={xScale(p.electionIdx)}
                cy={yScale(p.pct)}
                r={rScale(p.totalVotes)}
                fill={color}
                fillOpacity={isHovered ? 0.85 : 0.55}
                stroke={color}
                strokeWidth={isHovered ? 2 : 1}
                strokeOpacity={0.9}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHover(p)}
                onMouseLeave={() => setHover((h) => (h === p ? null : h))}
                onClick={() =>
                  navigate(
                    `/party/${encodeURIComponent(p.nickName)}?elections=${p.electionName}`,
                  )
                }
              >
                <title>{`${p.nickName} — ${localDate(p.electionName)}`}</title>
              </circle>
            );
          })}
        </g>

        {/* Hover label band */}
        {hover && (
          <g
            transform={`translate(${MARGIN.left + xScale(hover.electionIdx)}, ${MARGIN.top + yScale(hover.pct) - rScale(hover.totalVotes) - 8})`}
            pointerEvents="none"
          >
            <rect
              x={-90}
              y={-44}
              width={180}
              height={42}
              rx={4}
              className="fill-popover stroke-border"
              strokeWidth={1}
            />
            <text
              x={0}
              y={-28}
              textAnchor="middle"
              className="text-xs font-semibold fill-popover-foreground"
            >
              {hover.nickName}
            </text>
            <text
              x={0}
              y={-14}
              textAnchor="middle"
              className="text-[10px] fill-popover-foreground"
            >
              {localDate(hover.electionName)} · {formatPct(hover.pct, 1)} ·{" "}
              {formatThousands(hover.totalVotes)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
};
