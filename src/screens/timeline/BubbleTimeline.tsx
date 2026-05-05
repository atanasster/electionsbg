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
  // The actual nickName to route to for the party detail page. In
  // non-consolidated mode this is the same as nickName; in consolidated mode
  // nickName is the canonical label (e.g. ПП-ДБ) which may not exist in past
  // elections, so we route to the largest-vote member that actually ran.
  routeNickName: string;
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
  // Returns the full party name for a (nickName, election) pair, used in the
  // hover tooltip when available.
  fullNameFor?: (nickName: string, election: string) => string | undefined;
  // Returns the canonical display name for a nickName (used in consolidated
  // mode to label lineage groups under a single name).
  displayNameFor?: (nickName: string) => string | undefined;
  // Returns the canonical display name for a lineage id. Used in consolidated
  // mode where the merged group's label should follow the lineage (e.g. PP-DB)
  // rather than whichever predecessor nickname happened to come first.
  displayNameForId?: (id: string) => string | undefined;
  // Compact mode tightens margins, shrinks bubbles + labels and drops the
  // min-width constraint so the chart fits inside dashboard cards.
  compact?: boolean;
  // When true, bubbles for parties sharing a canonical lineage are merged into
  // one bubble per election (votes summed) and labelled by canonical name.
  consolidated?: boolean;
};

const MARGIN_DEFAULT = { top: 24, right: 24, bottom: 56, left: 48 };
const MARGIN_COMPACT = { top: 10, right: 24, bottom: 54, left: 44 };

export const BubbleTimeline: FC<Props> = ({
  stats,
  minPct = 0.5,
  height,
  colorFor,
  lineageFor,
  fullNameFor,
  displayNameFor,
  displayNameForId,
  compact = false,
  consolidated = false,
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
      if (!total) return;
      if (consolidated && lineageFor) {
        // Group votes within this election by canonical lineage so rebrands /
        // splits / mergers collapse into one bubble per lineage per election.
        // We also track the largest-vote member so a click on a consolidated
        // bubble routes to a party page that actually exists in that election
        // (the canonical name itself may not — e.g. ПП-ДБ in 2021_11_14).
        const groups = new Map<
          string,
          {
            nickName: string;
            partyNum: number;
            totalVotes: number;
            biggestNickName: string;
            biggestVotes: number;
          }
        >();
        const ungrouped: BubblePoint[] = [];
        e.results?.votes.forEach((v) => {
          if (!v.totalVotes) return;
          const nick = v.nickName ?? `#${v.partyNum}`;
          const id = lineageFor(nick);
          if (!id) {
            const pct = (100 * v.totalVotes) / total;
            if (pct < minPct) return;
            ungrouped.push({
              electionIdx: idx,
              electionName: e.name,
              partyNum: v.partyNum,
              nickName: nick,
              routeNickName: nick,
              totalVotes: v.totalVotes,
              pct,
            });
            return;
          }
          const prev = groups.get(id);
          if (prev) {
            prev.totalVotes += v.totalVotes;
            if (v.totalVotes > prev.biggestVotes) {
              prev.biggestNickName = nick;
              prev.biggestVotes = v.totalVotes;
              prev.partyNum = v.partyNum;
            }
          } else {
            groups.set(id, {
              nickName:
                displayNameForId?.(id) ?? displayNameFor?.(nick) ?? nick,
              partyNum: v.partyNum,
              totalVotes: v.totalVotes,
              biggestNickName: nick,
              biggestVotes: v.totalVotes,
            });
          }
        });
        groups.forEach((g) => {
          const pct = (100 * g.totalVotes) / total;
          if (pct < minPct) return;
          ps.push({
            electionIdx: idx,
            electionName: e.name,
            partyNum: g.partyNum,
            nickName: g.nickName,
            routeNickName: g.biggestNickName,
            totalVotes: g.totalVotes,
            pct,
          });
          if (pct > maxP) maxP = pct;
          if (g.totalVotes > maxV) maxV = g.totalVotes;
        });
        ungrouped.forEach((p) => {
          ps.push(p);
          if (p.pct > maxP) maxP = p.pct;
          if (p.totalVotes > maxV) maxV = p.totalVotes;
        });
        return;
      }
      e.results?.votes.forEach((v) => {
        if (!v.totalVotes) return;
        const pct = (100 * v.totalVotes) / total;
        if (pct < minPct) return;
        const nick = v.nickName ?? `#${v.partyNum}`;
        ps.push({
          electionIdx: idx,
          electionName: e.name,
          partyNum: v.partyNum,
          nickName: nick,
          routeNickName: nick,
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
  }, [
    stats,
    minPct,
    consolidated,
    lineageFor,
    displayNameFor,
    displayNameForId,
  ]);

  const MARGIN = compact ? MARGIN_COMPACT : MARGIN_DEFAULT;
  const W = 1000;
  const H = height ?? (compact ? 220 : 480);
  const innerW = W - MARGIN.left - MARGIN.right;
  const innerH = H - MARGIN.top - MARGIN.bottom;
  const axisCls = compact
    ? "fill-muted-foreground text-[9px]"
    : "fill-muted-foreground text-xs";

  // Horizontal inset keeps the first/last bubbles away from the axis labels
  // (Y labels on the left, chart frame on the right) so large bubbles at the
  // edges don't overlap them.
  const xPad = compact ? 14 : 12;
  const xScale = (idx: number) =>
    elections.length <= 1
      ? innerW / 2
      : xPad + (idx * (innerW - 2 * xPad)) / (elections.length - 1);

  const yScale = (pct: number) => innerH - (pct / Math.max(maxPct, 1)) * innerH;

  // Bubble radius scales by sqrt(votes) so AREA is proportional to votes.
  const rScale = (votes: number) => {
    if (!maxVotes) return compact ? 2 : 4;
    const rMax = compact ? 12 : 28;
    const rMin = compact ? 2 : 4;
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
    <div className={compact ? "w-full" : "w-full overflow-x-auto"}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t("timeline_title")}
        className={compact ? "w-full" : "w-full min-w-[720px]"}
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
                className={axisCls}
              >
                {v}%
              </text>
            </g>
          ))}

          {/* X axis labels */}
          {elections.map((name, idx) => (
            <g key={name} transform={`translate(${xScale(idx)}, ${innerH})`}>
              <line
                y1={0}
                y2={compact ? 4 : 6}
                stroke="currentColor"
                strokeOpacity={0.3}
              />
              <text
                transform={compact ? "rotate(-40)" : undefined}
                y={compact ? 10 : 20}
                textAnchor={compact ? "end" : "middle"}
                className={axisCls}
              >
                {localDate(name).slice(3)}
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
                    `/party/${encodeURIComponent(p.routeNickName)}?elections=${p.electionName}`,
                  )
                }
              />
            );
          })}
        </g>

        {/* Hover label band */}
        {hover &&
          (() => {
            const r = rScale(hover.totalVotes);
            const bx = MARGIN.left + xScale(hover.electionIdx);
            const by = MARGIN.top + yScale(hover.pct);
            const fullName = fullNameFor?.(hover.nickName, hover.electionName);
            const tw = 220;
            const gap = 8;
            // Estimate height: header (16) + optional full name (~12 per ~30
            // chars wrapped) + stats line (14) + vertical padding (12).
            const fullNameLines = fullName
              ? Math.min(3, Math.ceil(fullName.length / 30))
              : 0;
            const th = 16 + fullNameLines * 12 + 14 + 12;
            const showBelow = by - r - gap - th < 0;
            const tx = Math.max(tw / 2, Math.min(W - tw / 2, bx));
            const ty = showBelow ? by + r + gap : by - r - gap;
            const ry = showBelow ? 0 : -th;
            return (
              <g transform={`translate(${tx}, ${ty})`} pointerEvents="none">
                <rect
                  x={-tw / 2}
                  y={ry}
                  width={tw}
                  height={th}
                  rx={4}
                  className="fill-primary"
                />
                <foreignObject x={-tw / 2} y={ry} width={tw} height={th}>
                  <div
                    className="text-primary-foreground px-2 py-1.5 text-center leading-tight"
                    style={{ fontSize: 10 }}
                  >
                    <div className="font-semibold" style={{ fontSize: 11 }}>
                      {displayNameFor?.(hover.nickName) ?? hover.nickName}
                    </div>
                    {fullName && (
                      <div
                        className="opacity-90 mt-0.5"
                        style={{ fontSize: 9 }}
                      >
                        {fullName}
                      </div>
                    )}
                    <div className="opacity-80 mt-0.5" style={{ fontSize: 9 }}>
                      {localDate(hover.electionName)} ·{" "}
                      {formatPct(hover.pct, 1)} ·{" "}
                      {formatThousands(hover.totalVotes)}
                    </div>
                  </div>
                </foreignObject>
              </g>
            );
          })()}
      </svg>
    </div>
  );
};
