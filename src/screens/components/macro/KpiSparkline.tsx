// Sparkline tuned for the /indicators KPI tiles. Paints horizontal-stripe
// cabinet-colour bands behind the polyline so the user can read which
// government held office during any movement in the line. Inline SVG to keep
// the bundle small — Recharts would be overkill at this size.
//
// Distinct from src/ux/Sparkline.tsx: that one renders a flat coloured area
// under the line and is used in tables where cabinet context is irrelevant.

import { FC, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { Government } from "@/data/governments/useGovernments";
import type { MacroPoint } from "@/data/macro/useMacro";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { toFractionalYear } from "@/screens/components/governments/governmentTimelineUtils";
import { colorForGovernment } from "@/screens/components/governments/governmentColors";

type Props = {
  points: MacroPoint[];
  governments: Government[];
  /** Line colour — keep it semantically neutral (a single accent) since the
   *  cabinet bands carry the political colouring. */
  color?: string;
  className?: string;
  ariaLabel?: string;
  /** Inclusive lower bound on the x-axis (decimal year). Defaults to the
   *  earliest point's year-fraction. */
  xMin?: number;
  /** Inclusive upper bound on the x-axis. Defaults to the latest point's
   *  year-fraction. */
  xMax?: number;
};

const W = 100;
const H = 28;
const PAD_Y = 2;

// Inline copy of pointToFractionalX from useMacro.ts — kept local to avoid an
// import cycle since useMacro pulls from data/ and this lives under screens/.
const fractionalX = (p: MacroPoint): number =>
  p.quarter ? p.year + (p.quarter - 1) * 0.25 + 0.125 : p.year + 0.5;

export const KpiSparkline: FC<Props> = ({
  points,
  governments,
  color = "currentColor",
  className,
  ariaLabel,
  xMin,
  xMax,
}) => {
  const { colorFor } = useCanonicalParties();

  const { bands, linePath, areaPath, endDot, xLo, xHi } = useMemo(() => {
    if (points.length === 0) {
      return {
        bands: [] as { x: number; w: number; fill: string }[],
        linePath: "",
        areaPath: "",
        endDot: null as { x: number; y: number } | null,
        xLo: 0,
        xHi: 0,
      };
    }
    const xs = points.map(fractionalX);
    const computedLo = xMin ?? xs[0];
    const computedHi = xMax ?? xs[xs.length - 1];
    const span = computedHi - computedLo;
    const toSvgX = (x: number) =>
      span > 0 ? ((x - computedLo) / span) * W : W / 2;

    const ys = points.map((p) => p.value);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    // Pad the y-domain by 5% so the line doesn't hug the SVG edges. For
    // single-value series, widen artificially so the line lands mid-height.
    const range = maxY - minY;
    const pad = range > 0 ? range * 0.05 : Math.abs(maxY) * 0.05 + 1;
    const yLo = minY - pad;
    const yHi = maxY + pad;
    const toSvgY = (y: number) => {
      const ratio = (y - yLo) / (yHi - yLo);
      return H - PAD_Y - ratio * (H - 2 * PAD_Y);
    };

    // Cabinet bands clipped to the visible x-window.
    const bandList: { x: number; w: number; fill: string }[] = [];
    for (const g of governments) {
      const gStart = toFractionalYear(g.startDate);
      const gEnd = toFractionalYear(g.endDate ?? new Date().toISOString());
      const lo = Math.max(gStart, computedLo);
      const hi = Math.min(gEnd, computedHi);
      if (hi <= lo) continue;
      bandList.push({
        x: toSvgX(lo),
        w: toSvgX(hi) - toSvgX(lo),
        fill: colorForGovernment(g, colorFor, 0.22),
      });
    }

    const pts = points.map(
      (p) => [toSvgX(fractionalX(p)), toSvgY(p.value)] as const,
    );
    const line = pts
      .map(
        ([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`,
      )
      .join(" ");
    const last = pts[pts.length - 1];
    const area = `${line} L${last[0].toFixed(2)},${H} L${pts[0][0].toFixed(2)},${H} Z`;

    return {
      bands: bandList,
      linePath: line,
      areaPath: area,
      endDot: { x: last[0], y: last[1] },
      xLo: computedLo,
      xHi: computedHi,
    };
  }, [points, governments, colorFor, xMin, xMax]);

  if (points.length === 0) return null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
      data-x-domain={`${xLo.toFixed(2)}-${xHi.toFixed(2)}`}
      className={cn("inline-block w-full h-7", className)}
    >
      {bands.map((b, i) => (
        <rect
          key={i}
          x={b.x}
          y={0}
          width={b.w}
          height={H}
          fill={b.fill}
          stroke="none"
        />
      ))}
      <path d={areaPath} fill={color} fillOpacity={0.12} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {endDot && (
        <circle
          cx={endDot.x}
          cy={endDot.y}
          r={1.6}
          fill={color}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
};
