import { FC } from "react";
import { cn } from "@/lib/utils";

// A loading placeholder shaped like what it stands in for (motion-v1 §3.5, §4.3): faint marks
// under a slow shimmer. It replaces a uniformly pulsing grey box, which says „something" where
// this says „a chart / a ranking / a map is coming".
//
//   bars  — a baseline and columns: charts, and the mixed tile packs
//   dots  — a scatter
//   rows  — a ranked list or table: a label stub and a bar per row
//   map   — a soft landmass with a few points; deliberately NOT a real outline, so the ghost
//           claims no geography
//
// ⚠️ IT RESERVES HEIGHT EXACTLY LIKE THE BOX IT REPLACES. Pass the same height class the old
// placeholder had (`h-[280px]`); the shell — `rounded-xl border bg-card` — is the same, so the
// arriving content lands without moving the page.
//
// ⚠️ THE GHOST DOES NOT GROW INTO THE REAL VALUES. The marks are invented, and morphing invented
// bars into real ones would animate data arriving on first paint — the fade-from-placeholder
// §0 rules out (the same reason `FeatureMap` never fades in from its grey). The real content
// simply replaces the ghost. The shimmer is the only motion, it means „loading", and it stops
// under prefers-reduced-motion (index.css).
//
// Every mark is a fixed constant, so the ghost is identical on every render and on both sides
// of hydration.

export type ChartGhostShape = "bars" | "dots" | "rows" | "map";

/** Column heights, % of the plot. */
const BARS = [46, 68, 38, 82, 57, 72, 41, 63, 52];
/** Scatter centres, % of the plot. */
const DOTS: [number, number][] = [
  [8, 62],
  [16, 44],
  [23, 70],
  [31, 35],
  [39, 55],
  [46, 28],
  [54, 48],
  [61, 66],
  [68, 22],
  [76, 40],
  [83, 58],
  [91, 30],
];
/** Ranked-row bar lengths, % of the bar track — descending, as a ranking is. */
const ROWS = [94, 81, 70, 61, 52, 44, 37, 30];
/** A soft, irregular landmass in a 100 × 62 box, and a few points on it. */
const LAND =
  "M8,22 C14,10 30,8 44,11 C58,6 74,9 86,14 C95,18 96,30 90,38 C93,47 84,54 72,52 C60,57 46,54 34,55 C22,57 10,50 9,40 C4,34 4,27 8,22 Z";
const PINS: [number, number][] = [
  [26, 28],
  [48, 22],
  [63, 36],
  [79, 26],
  [40, 44],
];

/** The plot area every shape draws in, inset from the card's edge. */
const PLOT =
  "absolute inset-x-6 bottom-6 top-8 h-[calc(100%-3.5rem)] w-[calc(100%-3rem)]";
const MARK = "hsl(var(--muted))";

const Bars: FC = () => (
  <svg className={PLOT} viewBox="0 0 100 100" preserveAspectRatio="none">
    <line
      x1={0}
      x2={100}
      y1={100}
      y2={100}
      stroke="hsl(var(--border))"
      strokeWidth={1}
      vectorEffect="non-scaling-stroke"
    />
    {BARS.map((h, i) => {
      const w = 100 / BARS.length;
      return (
        <rect
          key={i}
          x={i * w + w * 0.2}
          y={100 - h}
          width={w * 0.6}
          height={h}
          rx={1}
          fill={MARK}
        />
      );
    })}
  </svg>
);

/** UNSCALED: percentage centres with a pixel radius stay round at every aspect ratio, where a
 *  stretched viewBox turns dots into dashes on a wide card. */
const Dots: FC = () => (
  <svg className={cn(PLOT, "overflow-visible")}>
    <line
      x1="0%"
      x2="100%"
      y1="100%"
      y2="100%"
      stroke="hsl(var(--border))"
      strokeWidth={1}
    />
    {DOTS.map(([x, y], i) => (
      <circle key={i} cx={`${x}%`} cy={`${y}%`} r={4} fill={MARK} />
    ))}
  </svg>
);

const Rows: FC = () => (
  <svg className={PLOT} viewBox="0 0 100 100" preserveAspectRatio="none">
    {ROWS.map((w, i) => {
      const h = 100 / ROWS.length;
      const y = i * h + h * 0.3;
      return (
        <g key={i}>
          <rect x={0} y={y} width={18} height={h * 0.4} rx={1} fill={MARK} />
          <rect
            x={22}
            y={y}
            width={(w / 100) * 76}
            height={h * 0.4}
            rx={1}
            fill={MARK}
          />
        </g>
      );
    })}
  </svg>
);

/** `meet`, not `none`: a landmass must not stretch with the card the way a bar track may. */
const MapShape: FC = () => (
  <svg
    className={PLOT}
    viewBox="0 0 100 62"
    preserveAspectRatio="xMidYMid meet"
  >
    <path d={LAND} fill={MARK} />
    {PINS.map(([x, y], i) => (
      <circle key={i} cx={x} cy={y} r={1.6} fill="hsl(var(--card))" />
    ))}
  </svg>
);

const SHAPES: Record<ChartGhostShape, FC> = {
  bars: Bars,
  dots: Dots,
  rows: Rows,
  map: MapShape,
};

export const ChartGhost: FC<{
  /** The height class of the placeholder this replaces, e.g. `h-[280px]`. */
  className?: string;
  shape?: ChartGhostShape;
}> = ({ className, shape = "bars" }) => {
  const Shape = SHAPES[shape];
  return (
    <div
      aria-hidden
      data-chart-ghost={shape}
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card",
        className,
      )}
    >
      <Shape />
      <div className="motion-shimmer pointer-events-none absolute inset-0" />
    </div>
  );
};
