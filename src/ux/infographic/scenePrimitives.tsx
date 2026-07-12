// Shared scene primitives — the marks that recur across infographic scenes, so a
// new scene composes them instead of re-hand-drawing bar rects and polylines.
// All draw in the SceneFrame contract: accent = `var(--sector)`, ink =
// `currentColor`, coordinates in the 300×116 viewBox. See ./README.md.

import { FC } from "react";

/** A rising bar group — the workhorse "some metric over time / rank" mark.
 *  Bars grow from `baseline` upward; opacity ramps light→solid unless disabled. */
export const Bars: FC<{
  x: number;
  baseline: number;
  heights: number[];
  barWidth?: number;
  gap?: number;
  opacityRamp?: boolean;
}> = ({ x, baseline, heights, barWidth = 10, gap = 4, opacityRamp = true }) => (
  <g fill="var(--sector)">
    {heights.map((h, i) => (
      <rect
        key={i}
        x={x + i * (barWidth + gap)}
        y={baseline - h}
        width={barWidth}
        height={h}
        rx={2}
        opacity={opacityRamp ? 0.5 + (0.5 * (i + 1)) / heights.length : 1}
      />
    ))}
  </g>
);

/** A trend polyline in ink, with an optional up-right arrowhead at the end. */
export const TrendLine: FC<{
  points: Array<[number, number]>;
  arrow?: boolean;
}> = ({ points, arrow = false }) => {
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p[0]} ${p[1]}`)
    .join(" ");
  const [ex, ey] = points[points.length - 1] ?? [0, 0];
  return (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d={d} />
      {arrow ? <path d={`M${ex} ${ey} l-11 1 M${ex} ${ey} l1 11`} /> : null}
    </g>
  );
};

/** A donut gauge — `pct` (0–1) of the ring drawn in the accent over a faint
 *  full ring in ink. Good for "share of budget / success rate" marks. */
export const Donut: FC<{
  cx: number;
  cy: number;
  r?: number;
  pct: number;
  thickness?: number;
}> = ({ cx, cy, r = 18, pct, thickness = 7 }) => {
  const circumference = 2 * Math.PI * r;
  return (
    <g transform={`translate(${cx} ${cy})`}>
      <circle
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={thickness}
        opacity="0.3"
      />
      <circle
        r={r}
        fill="none"
        stroke="var(--sector)"
        strokeWidth={thickness}
        strokeLinecap="round"
        strokeDasharray={`${circumference * Math.max(0, Math.min(1, pct))} ${circumference}`}
        transform="rotate(-90)"
      />
    </g>
  );
};
