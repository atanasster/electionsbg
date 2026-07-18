// Per-product price-history chart — the camelcamelcamel pattern.
//
// Range toggles (1м / 3м / всички) that RECOMPUTE the high/low/average, with the
// high and low annotated by the DATE they occurred, and a hover crosshair.
//
// GAP MASKING (design §3.2, §9.4). A day with no data point is a REPORTING GAP —
// the chain did not upload that day — NOT a flat price. The route already omits
// those days (it masks on price_chain_days), so here we must break the line
// across any date discontinuity rather than draw a straight segment through it.
// A flat line through a gap is the one lie the whole storage model was built to
// avoid telling.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HistoryPoint } from "@/data/prices/fetchPricePayload";
import { fmtEur, fmtPriceDate } from "@/data/prices/usePrices";

interface Props {
  points: HistoryPoint[];
  height?: number;
}

type Range = "1m" | "3m" | "all";

const DAY = 86400_000;

export const PriceHistoryChart: FC<Props> = ({ points, height = 220 }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const [range, setRange] = useState<Range>("all");
  const [hover, setHover] = useState<number | null>(null);

  const view = useMemo(() => {
    if (points.length === 0) return null;
    const lastMs = Date.parse(points[points.length - 1].day);
    const cutoff =
      range === "1m"
        ? lastMs - 30 * DAY
        : range === "3m"
          ? lastMs - 91 * DAY
          : 0;
    const pts = points.filter((p) => Date.parse(p.day) >= cutoff);
    if (pts.length < 2) return null;

    const vs = pts.map((p) => p.min_eur);
    let loI = 0;
    let hiI = 0;
    for (let i = 1; i < vs.length; i++) {
      if (vs[i] < vs[loI]) loI = i;
      if (vs[i] > vs[hiI]) hiI = i;
    }
    const avg = vs.reduce((s, v) => s + v, 0) / vs.length;
    return { pts, lo: pts[loI], hi: pts[hiI], avg };
  }, [points, range]);

  if (!view) return null;
  const { pts } = view;

  const W = 640;
  const H = height;
  const padX = 16;
  const padY = 18;
  const t0 = Date.parse(pts[0].day);
  const t1 = Date.parse(pts[pts.length - 1].day);
  const span = t1 - t0 || 1;
  const vals = pts.map((p) => p.min_eur);
  const vmin = Math.min(...vals);
  const vmax = Math.max(...vals);
  const vspan = vmax - vmin || 1;

  const x = (iso: string) =>
    padX + ((Date.parse(iso) - t0) / span) * (W - 2 * padX);
  const y = (v: number) => padY + (1 - (v - vmin) / vspan) * (H - 2 * padY);

  // Break the polyline wherever consecutive points are more than 1 day apart:
  // that discontinuity is a reporting gap, not a price that held flat.
  const segments: HistoryPoint[][] = [];
  let cur: HistoryPoint[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (
      i > 0 &&
      Date.parse(pts[i].day) - Date.parse(pts[i - 1].day) > 1.5 * DAY
    ) {
      segments.push(cur);
      cur = [];
    }
    cur.push(pts[i]);
  }
  if (cur.length) segments.push(cur);

  const T = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const hovPt = hover != null ? pts[hover] : null;

  // Map the pointer's screen X onto the CURRENT nearest data point. The SVG uses
  // the default `xMidYMid meet`, so on a wide container the viewBox is scaled to
  // fit and CENTERED with horizontal letterbox padding — the drawing does NOT
  // fill rect.width. Mapping screen→viewBox with rect.width alone therefore
  // over/undershoots by the letterbox offset, and the crosshair drifts away from
  // the cursor. Go through the element's own CTM instead, which folds in the
  // scale + letterbox translate exactly (FINDING-013).
  const nearestIndex = (svg: SVGSVGElement, clientX: number) => {
    const ctm = svg.getScreenCTM();
    // ctm.a = x-scale, ctm.e = x-translate (no rotation): userX = (screenX-e)/a.
    const px = ctm ? (clientX - ctm.e) / ctm.a : 0;
    let best = 0;
    let bestD = Infinity;
    pts.forEach((p, i) => {
      const d = Math.abs(x(p.day) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex gap-1">
          {(["1m", "3m", "all"] as Range[]).map((r) => (
            <button
              key={r}
              // Reset hover: it indexes the CURRENT pts, which range change
              // rebuilds — a stale crosshair would show a wrong date/price
              // until the next mouse move (FINDING-012).
              onClick={() => {
                setRange(r);
                setHover(null);
              }}
              aria-pressed={range === r}
              className={`px-2 py-0.5 text-xs rounded border ${
                range === r
                  ? "bg-primary text-primary-foreground border-primary"
                  : "text-muted-foreground border-border hover:bg-muted"
              }`}
            >
              {r === "1m"
                ? T("1 месец", "1 mo")
                : r === "3m"
                  ? T("3 месеца", "3 mo")
                  : T("всички", "all")}
            </button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {T("макс", "high")} {fmtEur(view.hi.min_eur, lang)} ·{" "}
          {T("мин", "low")} {fmtEur(view.lo.min_eur, lang)} · {T("ср.", "avg")}{" "}
          {fmtEur(view.avg, lang)}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`${T("Цена във времето", "Price over time")}: ${T("макс", "high")} ${fmtEur(view.hi.min_eur, lang)}, ${T("мин", "low")} ${fmtEur(view.lo.min_eur, lang)}, ${T("средно", "average")} ${fmtEur(view.avg, lang)}`}
        onMouseMove={(e) => setHover(nearestIndex(e.currentTarget, e.clientX))}
        onMouseLeave={() => setHover(null)}
      >
        {/* min/max annotation dots, labelled with their date */}
        <circle
          cx={x(view.lo.day)}
          cy={y(view.lo.min_eur)}
          r={3}
          className="fill-green-600 dark:fill-green-400"
        />
        <circle
          cx={x(view.hi.day)}
          cy={y(view.hi.min_eur)}
          r={3}
          className="fill-red-600 dark:fill-red-400"
        />

        {segments.map((seg, si) => (
          <polyline
            key={si}
            fill="none"
            strokeWidth={1.75}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="stroke-primary"
            points={seg.map((p) => `${x(p.day)},${y(p.min_eur)}`).join(" ")}
          />
        ))}

        {hovPt &&
          (() => {
            const px = x(hovPt.day);
            const py = y(hovPt.min_eur);
            const boxW = 104;
            const boxH = 36;
            // Clamp the box inside the viewBox; flip below the point if it would
            // clip the top edge.
            const bx = Math.min(Math.max(px - boxW / 2, 2), W - boxW - 2);
            const by = py - boxH - 10 < padY ? py + 10 : py - boxH - 10;
            return (
              <g>
                <line
                  x1={px}
                  x2={px}
                  y1={padY}
                  y2={H - padY}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <circle cx={px} cy={py} r={3.5} className="fill-primary" />
                <g pointerEvents="none">
                  <rect
                    x={bx}
                    y={by}
                    width={boxW}
                    height={boxH}
                    rx={5}
                    className="fill-card stroke-border"
                    strokeWidth={1}
                  />
                  <text
                    x={bx + boxW / 2}
                    y={by + 15}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={700}
                    className="fill-foreground tabular-nums"
                  >
                    {fmtEur(hovPt.min_eur, lang)}
                  </text>
                  <text
                    x={bx + boxW / 2}
                    y={by + 29}
                    textAnchor="middle"
                    fontSize={10}
                    className="fill-muted-foreground"
                  >
                    {fmtPriceDate(hovPt.day, lang)} · {hovPt.chains}{" "}
                    {T("вериги", "chains")}
                  </text>
                </g>
              </g>
            );
          })()}
      </svg>

      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>{fmtPriceDate(pts[0].day, lang)}</span>
        {hovPt ? (
          <span className="tabular-nums text-foreground">
            {fmtPriceDate(hovPt.day, lang)}: {fmtEur(hovPt.min_eur, lang)}
            {" · "}
            {hovPt.chains} {T("вериги", "chains")}
          </span>
        ) : (
          <span>
            {T("макс", "high")} {fmtPriceDate(view.hi.day, lang)} ·{" "}
            {T("мин", "low")} {fmtPriceDate(view.lo.day, lang)}
          </span>
        )}
        <span>{fmtPriceDate(pts[pts.length - 1].day, lang)}</span>
      </div>
    </div>
  );
};
