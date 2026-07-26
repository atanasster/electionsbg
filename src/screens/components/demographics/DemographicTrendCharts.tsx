import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { CensusMetric } from "@/data/census/censusTypes";
import type { DemographicCleavagesPayload } from "@/data/dashboard/useDemographicCleavages";
import { useDemographicTrends } from "@/data/dashboard/useDemographicTrends";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { localDate } from "@/data/utils";
import { useTooltip, type TooltipEvents } from "@/ux/useTooltip";
import { partyHref } from "@/lib/utils";
import { METRIC_BY_KEY } from "@/screens/components/demographics/censusMetrics";
import { fmtR } from "@/screens/components/demographics/demographicsFormat";

// How many of the most polarizing demographics (top rows by spread in the
// selected election) get their own trend chart.
const TOP_METRICS = 6;

// A party's presence across the (trimmed) election axis for one demographic.
type SeriesPoint = { idx: number; r: number; pct: number };
type Series = {
  canonicalId: string;
  nickName: string;
  color: string;
  points: SeriesPoint[];
};

// ---------------------------------------------------------------------------
// One small-multiple: correlation (Y, −1…+1) vs election (X), one bubble-line
// per party. Self-contained SVG with a viewBox so it scales to its grid cell
// without a measured-width hook — and preserveAspectRatio keeps bubbles round.
// ---------------------------------------------------------------------------
const MiniChart: FC<{
  label: string;
  axis: string[];
  series: Series[];
  maxPct: number;
  tooltipEvents: TooltipEvents;
}> = ({ label, axis, series, maxPct, tooltipEvents }) => {
  const W = 340;
  const H = 210;
  const M = { top: 10, right: 12, bottom: 40, left: 30 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  const xPad = 12;
  const xScale = (idx: number) =>
    axis.length <= 1
      ? innerW / 2
      : xPad + (idx * (innerW - 2 * xPad)) / (axis.length - 1);
  // r ∈ [−1, 1] → y; +1 at the top, 0 at the mid-line, −1 at the bottom.
  const yScale = (r: number) =>
    (innerH * (1 - Math.max(-1, Math.min(1, r)))) / 2;
  // Small dots with only a gentle salience nudge — the trajectory (line) is the
  // signal here, not the bubble area, so keep them from crowding the plot.
  const rScale = (pct: number) => {
    const rMin = 1.6;
    const rMax = 3.6;
    if (maxPct <= 0) return rMin;
    return rMin + Math.sqrt(Math.max(0, pct) / maxPct) * (rMax - rMin);
  };

  const yTicks = [1, 0.5, 0, -0.5, -1];
  // Thin the x labels when the axis is long; always keep first and last.
  const step = axis.length > 9 ? 2 : 1;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      className="w-full"
    >
      <g transform={`translate(${M.left}, ${M.top})`}>
        {/* Y grid + labels */}
        {yTicks.map((r) => {
          const zero = r === 0;
          return (
            <g key={r}>
              <line
                x1={0}
                y1={yScale(r)}
                x2={innerW}
                y2={yScale(r)}
                stroke="currentColor"
                strokeOpacity={zero ? 0.28 : 0.08}
                strokeDasharray={zero ? undefined : "3 3"}
              />
              <text
                x={-6}
                y={yScale(r)}
                dy={3}
                textAnchor="end"
                className="fill-muted-foreground text-[8px] tabular-nums"
              >
                {r > 0 ? `+${r}` : r}
              </text>
            </g>
          );
        })}

        {/* X ticks + thinned labels */}
        {axis.map((name, idx) => {
          const show = idx % step === 0 || idx === axis.length - 1;
          return (
            <g key={name} transform={`translate(${xScale(idx)}, ${innerH})`}>
              <line y1={0} y2={4} stroke="currentColor" strokeOpacity={0.25} />
              {show && (
                <text
                  transform="rotate(-45)"
                  y={8}
                  x={-2}
                  textAnchor="end"
                  className="fill-muted-foreground text-[8px]"
                >
                  {localDate(name).slice(3)}
                </text>
              )}
            </g>
          );
        })}

        {/* Party threads (under the bubbles) */}
        {series.map((s) =>
          s.points.length < 2 ? null : (
            <polyline
              key={`line-${s.canonicalId}`}
              fill="none"
              stroke={s.color}
              strokeWidth={1.5}
              strokeOpacity={0.55}
              strokeLinecap="round"
              strokeLinejoin="round"
              points={s.points
                .map(
                  (p) =>
                    `${xScale(p.idx).toFixed(1)},${yScale(p.r).toFixed(1)}`,
                )
                .join(" ")}
            />
          ),
        )}

        {/* Bubbles */}
        {series.map((s) =>
          s.points.map((p) => (
            <circle
              key={`${s.canonicalId}-${p.idx}`}
              cx={xScale(p.idx)}
              cy={yScale(p.r)}
              r={rScale(p.pct)}
              fill={s.color}
              fillOpacity={0.9}
              stroke={s.color}
              strokeWidth={0.5}
              strokeOpacity={0.9}
              style={{ cursor: "pointer" }}
              onMouseEnter={(e) =>
                tooltipEvents.onMouseEnter(
                  { pageX: e.pageX, pageY: e.pageY },
                  <div className="text-left text-xs">
                    <div className="font-semibold pb-1 mb-1 border-b border-border">
                      {label}
                    </div>
                    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                      <span className="text-muted-foreground">
                        {s.nickName}
                      </span>
                      <span
                        className="font-semibold tabular-nums text-right"
                        style={{ color: s.color }}
                      >
                        {fmtR(p.r)}
                      </span>
                      <span className="text-muted-foreground">
                        {localDate(axis[p.idx])}
                      </span>
                      <span className="tabular-nums text-right">
                        {p.pct.toFixed(1)}%
                      </span>
                    </div>
                  </div>,
                )
              }
              onMouseMove={(e) =>
                tooltipEvents.onMouseMove({ pageX: e.pageX, pageY: e.pageY })
              }
              onMouseLeave={tooltipEvents.onMouseLeave}
            />
          )),
        )}
      </g>
    </svg>
  );
};

// Small-multiple bubble-line trend charts: for each of the most polarizing
// demographics in the selected election, how every top party's correlation with
// that demographic has moved across every election it contested. Reads the
// precomputed cross-election trends artifact; the selected election only decides
// which demographics rank as "top" and which parties to thread.
export const DemographicTrendCharts: FC<{
  cleavages: DemographicCleavagesPayload;
}> = ({ cleavages }) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { data: trends } = useDemographicTrends();
  const { canonicalIdFor, displayNameFor } = useCanonicalParties();
  const { tooltip, ...tooltipEvents } = useTooltip();

  const metricLabel = (m: CensusMetric) => {
    const def = METRIC_BY_KEY[m];
    return def ? t(def.i18nKey) : m;
  };

  const model = useMemo(() => {
    if (!trends) return undefined;
    const byCanonical = new Map(trends.parties.map((p) => [p.canonicalId, p]));

    // The selected election's top parties (dot-plot legend order), each threaded
    // to its full cross-election lineage. Deduped by canonical id.
    const seen = new Set<string>();
    const shown: { nickName: string; color: string; canonicalId: string }[] =
      [];
    for (const p of cleavages.parties) {
      const cid = canonicalIdFor(p.nickName);
      if (!cid || seen.has(cid) || !byCanonical.has(cid)) continue;
      seen.add(cid);
      shown.push({
        canonicalId: cid,
        color: p.color ?? byCanonical.get(cid)?.color ?? "#888",
        nickName: isBg
          ? p.nickName
          : (displayNameFor(p.nickName) ?? p.nickName),
      });
    }
    if (shown.length < 2) return undefined;

    // Trim the election axis to the range these lineages actually cover.
    const present = new Set<string>();
    for (const s of shown)
      byCanonical
        .get(s.canonicalId)!
        .points.forEach((pt) => present.add(pt.election));
    const axis = trends.elections.filter((e) => present.has(e));
    const axisIdx = new Map(axis.map((e, i) => [e, i]));

    let maxPct = 0;
    for (const s of shown)
      for (const pt of byCanonical.get(s.canonicalId)!.points)
        if (pt.pctNational > maxPct) maxPct = pt.pctNational;

    // Top demographics by spread — cleavages.rows is pre-sorted spread-desc.
    const metrics = cleavages.rows
      .map((r) => r.metric)
      .filter((m) => trends.metrics.includes(m))
      .slice(0, TOP_METRICS);

    const charts = metrics.map((metric) => {
      const mi = trends.metrics.indexOf(metric);
      const series: Series[] = shown.map((s) => {
        const tp = byCanonical.get(s.canonicalId)!;
        return {
          canonicalId: s.canonicalId,
          nickName: s.nickName,
          color: s.color,
          points: tp.points
            .filter((pt) => axisIdx.has(pt.election))
            .map((pt) => ({
              idx: axisIdx.get(pt.election)!,
              r: pt.rs[mi] ?? 0,
              pct: pt.pctNational,
            })),
        };
      });
      return { metric, series };
    });

    return { shown, axis, maxPct, charts };
  }, [trends, cleavages, canonicalIdFor, displayNameFor, isBg]);

  if (!model) return null;

  return (
    <div>
      {/* Party legend (shared across every small multiple) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 mb-3 text-[11px]">
        {model.shown.map((s) => (
          <Link
            key={s.canonicalId}
            to={partyHref(s.nickName)}
            className="flex items-center gap-1 hover:underline"
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="font-medium">{s.nickName}</span>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-3">
        {model.charts.map(({ metric, series }) => (
          <div key={metric}>
            <div className="text-xs font-medium text-foreground mb-0.5">
              {metricLabel(metric)}
            </div>
            <MiniChart
              label={metricLabel(metric)}
              axis={model.axis}
              series={series}
              maxPct={model.maxPct}
              tooltipEvents={tooltipEvents}
            />
          </div>
        ))}
      </div>

      {tooltip}

      <p className="text-[10px] text-muted-foreground italic mt-3">
        {t("party_demographics_trends_note")}
      </p>
    </div>
  );
};
