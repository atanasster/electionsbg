// Compact dependency-free SVG sparkline for the price index series
// (baseline = 100). Used in tight spots (dashboard header stat, my-area tile)
// where a full axed chart doesn't fit — for the full trend chart see
// PriceIndexTrendChart.
//
// The daily КЗП basket is noisy, so plotting it raw draws a squiggle. We plot a
// trailing moving average instead (see movingAverage) so even at this size the
// line reads as a trend. A faint 100 reference line + a soft area fill keep it
// consistent with the full chart's look.

import { FC } from "react";
import { movingAverage, type PricePoint } from "@/data/prices/usePrices";

interface Props {
  points: PricePoint[];
  width?: number;
  height?: number;
  className?: string;
  /** Trailing-average window in points. Smaller for already-coarse (weekly)
   *  series so they aren't over-smoothed. */
  smoothWindow?: number;
}

export const PriceSparkline: FC<Props> = ({
  points,
  width = 160,
  height = 40,
  className,
  smoothWindow = 7,
}) => {
  if (points.length < 2) return null;
  const smooth = movingAverage(points, smoothWindow);
  const vs = smooth.map((p) => p.v);
  const min = Math.min(100, ...vs);
  const max = Math.max(100, ...vs);
  const span = max - min || 1;
  const pad = 3;
  const x = (i: number) => pad + (i / (smooth.length - 1)) * (width - 2 * pad);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - 2 * pad);
  const linePts = smooth.map((p, i) => `${x(i)},${y(p.v)}`).join(" ");
  const y100 = y(100);
  // Semantic hue keyed off the RAW latest so it matches the headline % stat
  // (which is computed from the raw series, not the smoothed one).
  const last = points[points.length - 1].v;
  // text-* sets `currentColor`, so both the stroke and the area fill track it
  // and follow dark mode without hardcoded hex.
  const colorClass =
    last > 100.05
      ? "text-red-600 dark:text-red-400"
      : last < 99.95
        ? "text-green-600 dark:text-green-400"
        : "text-slate-500 dark:text-slate-400";
  const x0 = x(0);
  const xN = x(smooth.length - 1);
  const areaPath = `M ${linePts.split(" ")[0]} L ${smooth
    .slice(1)
    .map((p, i) => `${x(i + 1)},${y(p.v)}`)
    .join(" L ")} L ${xN},${height - pad} L ${x0},${height - pad} Z`;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
    >
      <line
        x1={pad}
        x2={width - pad}
        y1={y100}
        y2={y100}
        stroke="currentColor"
        strokeWidth={1}
        strokeDasharray="2 2"
        className="text-border"
      />
      <path
        d={areaPath}
        fill="currentColor"
        fillOpacity={0.12}
        className={colorClass}
      />
      <polyline
        className={colorClass}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={linePts}
      />
    </svg>
  );
};
