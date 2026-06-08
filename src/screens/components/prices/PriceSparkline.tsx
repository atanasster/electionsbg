// Tiny dependency-free SVG sparkline for the price index series (baseline=100).
// Draws a faint 100 reference line so "above/below the euro-day basket" reads
// at a glance.

import { FC } from "react";

interface Props {
  points: { d: string; v: number }[];
  width?: number;
  height?: number;
  className?: string;
}

export const PriceSparkline: FC<Props> = ({
  points,
  width = 160,
  height = 40,
  className,
}) => {
  if (points.length < 2) return null;
  const vs = points.map((p) => p.v);
  const min = Math.min(100, ...vs);
  const max = Math.max(100, ...vs);
  const span = max - min || 1;
  const pad = 3;
  const x = (i: number) => pad + (i / (points.length - 1)) * (width - 2 * pad);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - 2 * pad);
  const path = points.map((p, i) => `${x(i)},${y(p.v)}`).join(" ");
  const y100 = y(100);
  const last = points[points.length - 1].v;
  // Tailwind stroke classes (not hardcoded hex) so the line tracks dark mode,
  // matching the dark: text variants used elsewhere in the tile.
  const strokeClass =
    last > 100.05
      ? "stroke-red-600 dark:stroke-red-400"
      : last < 99.95
        ? "stroke-green-600 dark:stroke-green-400"
        : "stroke-slate-500 dark:stroke-slate-400";
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
      <polyline
        className={strokeClass}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={path}
      />
    </svg>
  );
};
