import { FC, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LineChart } from "lucide-react";
import { localDate, formatPct, totalIncomeFiling } from "@/data/utils";
import { formatEur } from "@/lib/currency";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useFinancingTrends } from "@/data/financing/useFinancingTrends";
import { StatCard } from "@/screens/dashboard/StatCard";

type Pt = {
  electionIdx: number;
  electionName: string;
  partyNum: number;
  nickName: string;
  color?: string;
  income: number;
  pct: number; // share of the election's total campaign income
};

const MARGIN = { top: 16, right: 24, bottom: 52, left: 52 };
const MIN_PCT = 0.4; // hide tiny parties to reduce clutter

// Historical campaign-financing bubble chart across the elections that have
// financing data (currently three). Modelled on the votes BubbleTimeline:
// vertical position = share of that election's total income, bubble area ∝
// income, colour = party, lines thread a party across elections.
export const FinancingTrendsTile: FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const trends = useFinancingTrends();
  const { colorFor, canonicalIdFor, displayNameFor } = useCanonicalParties();
  const [hover, setHover] = useState<Pt | null>(null);

  const { points, elections, maxPct, maxIncome } = useMemo(() => {
    const ps: Pt[] = [];
    let maxP = 0;
    let maxI = 0;
    trends.forEach((e, idx) => {
      const byNum = new Map(e.parties.map((p) => [p.number, p]));
      const incomes = e.financing.map((r) => ({
        num: r.party,
        income: totalIncomeFiling(r.filing.income),
      }));
      const total = incomes.reduce((s, x) => s + x.income, 0);
      if (!total) return;
      incomes.forEach(({ num, income }) => {
        if (income <= 0) return;
        const pct = (100 * income) / total;
        if (pct < MIN_PCT) return;
        const pi = byNum.get(num);
        const nick = pi?.nickName ?? `#${num}`;
        ps.push({
          electionIdx: idx,
          electionName: e.name,
          partyNum: num,
          nickName: nick,
          color: colorFor(nick) || pi?.color,
          income,
          pct,
        });
        if (pct > maxP) maxP = pct;
        if (income > maxI) maxI = income;
      });
    });
    return {
      points: ps,
      elections: trends.map((e) => e.name),
      maxPct: maxP,
      maxIncome: maxI,
    };
  }, [trends, colorFor]);

  if (elections.length < 2 || points.length === 0) return null;

  const W = 1000;
  const H = 360;
  const innerW = W - MARGIN.left - MARGIN.right;
  const innerH = H - MARGIN.top - MARGIN.bottom;
  const xPad = 16;
  const xScale = (idx: number) =>
    elections.length <= 1
      ? innerW / 2
      : xPad + (idx * (innerW - 2 * xPad)) / (elections.length - 1);
  // Headroom above the tallest bubble so a large bubble at max share isn't
  // clipped by the top edge.
  const yMax = Math.max(maxPct, 1) * 1.15;
  const yScale = (pct: number) => innerH - (pct / yMax) * innerH;
  const rScale = (income: number) => {
    if (!maxIncome) return 4;
    return 4 + Math.sqrt(income / maxIncome) * 28;
  };
  const yTicks = [0, 10, 20, 30, 40, 50].filter((v) => v <= Math.ceil(maxPct));

  // One polyline per canonical party lineage with ≥2 bubbles.
  const lineages: {
    id: string;
    color: string;
    pts: { x: number; y: number }[];
  }[] = [];
  const grouped = new Map<string, Pt[]>();
  points.forEach((p) => {
    const id = canonicalIdFor(p.nickName);
    if (!id) return;
    const list = grouped.get(id) ?? [];
    list.push(p);
    grouped.set(id, list);
  });
  grouped.forEach((bubbles, id) => {
    if (bubbles.length < 2) return;
    const sorted = [...bubbles].sort((a, b) => a.electionIdx - b.electionIdx);
    lineages.push({
      id,
      color: sorted[sorted.length - 1].color || "#888",
      pts: sorted.map((p) => ({ x: xScale(p.electionIdx), y: yScale(p.pct) })),
    });
  });

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <LineChart className="h-4 w-4" />
          <span>{t("financing_trends")}</span>
        </div>
      }
      hint={t("financing_trends_hint")}
      className="overflow-hidden"
    >
      <div className="w-full overflow-x-auto">
        {/* Cap the rendered width so the fixed-unit axis text isn't magnified
            by a large viewBox→screen scale on wide monitors (a 3-point chart
            doesn't need the full page width). */}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={t("financing_trends")}
          className="mx-auto block w-full min-w-[480px] max-w-[1040px]"
        >
          <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
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
                  className="fill-muted-foreground text-[11px]"
                >
                  {v}%
                </text>
              </g>
            ))}

            {elections.map((name, idx) => (
              <g key={name} transform={`translate(${xScale(idx)}, ${innerH})`}>
                <line y1={0} y2={6} stroke="currentColor" strokeOpacity={0.3} />
                <text
                  y={22}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[11px]"
                >
                  {localDate(name)}
                </text>
              </g>
            ))}

            {lineages.map((l) => (
              <polyline
                key={l.id}
                fill="none"
                stroke={l.color}
                strokeWidth={1.5}
                strokeOpacity={0.35}
                strokeLinecap="round"
                strokeLinejoin="round"
                points={l.pts
                  .map((pt) => `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`)
                  .join(" ")}
              />
            ))}

            {points.map((p, i) => {
              const isHovered = hover === p;
              const color = p.color || "#888";
              return (
                <circle
                  key={`${p.electionName}-${p.partyNum}-${i}`}
                  cx={xScale(p.electionIdx)}
                  cy={yScale(p.pct)}
                  r={rScale(p.income)}
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
                />
              );
            })}
          </g>

          {hover &&
            (() => {
              const r = rScale(hover.income);
              const bx = MARGIN.left + xScale(hover.electionIdx);
              const by = MARGIN.top + yScale(hover.pct);
              const tw = 200;
              const th = 46;
              const gap = 8;
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
                    rx={6}
                    style={{
                      fill: "hsl(var(--popover))",
                      stroke: "hsl(var(--border))",
                      strokeWidth: 1,
                      filter:
                        "drop-shadow(0 4px 6px rgb(0 0 0 / 0.07)) drop-shadow(0 2px 4px rgb(0 0 0 / 0.06))",
                    }}
                  />
                  <foreignObject x={-tw / 2} y={ry} width={tw} height={th}>
                    <div
                      className="text-popover-foreground px-2 py-1.5 text-center leading-tight"
                      style={{ fontSize: 10 }}
                    >
                      <div className="font-semibold" style={{ fontSize: 11 }}>
                        {displayNameFor?.(hover.nickName) ?? hover.nickName}
                      </div>
                      <div
                        className="text-muted-foreground mt-0.5"
                        style={{ fontSize: 9 }}
                      >
                        {localDate(hover.electionName)} ·{" "}
                        {formatEur(hover.income, i18n.language)} ·{" "}
                        {formatPct(hover.pct, 1)}
                      </div>
                    </div>
                  </foreignObject>
                </g>
              );
            })()}
        </svg>
      </div>
    </StatCard>
  );
};
