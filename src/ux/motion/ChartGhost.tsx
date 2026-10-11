import { FC } from "react";
import { cn } from "@/lib/utils";

// A loading placeholder shaped like the chart it stands in for (motion-v1 §3.5): a baseline
// and faint marks, with a slow shimmer passing over them. It replaces a uniformly pulsing grey
// box, which says „something" where this says „a chart is coming".
//
// ⚠️ IT RESERVES HEIGHT EXACTLY LIKE THE BOX IT REPLACES. Pass the same height class the old
// placeholder had (`h-[280px]`); the shell — `rounded-xl border bg-card` — is the same, so the
// arriving content lands without moving the page.
//
// ⚠️ THE GHOST DOES NOT GROW INTO THE REAL VALUES. The marks are invented, and morphing invented
// bars into real ones would animate data arriving on first paint — the fade-from-placeholder
// §0 rules out (the same reason `FeatureMap` never fades in from its grey). The real chart
// simply replaces the ghost. The shimmer is the only motion, it means „loading", and it stops
// under prefers-reduced-motion (index.css).

/** Fixed, varied heights (% of the plot): deterministic so the ghost is identical on every
 *  render and on both sides of hydration. */
const BARS = [46, 68, 38, 82, 57, 72, 41, 63, 52];
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

export const ChartGhost: FC<{
  /** The height class of the placeholder this replaces, e.g. `h-[280px]`. */
  className?: string;
  shape?: "bars" | "dots";
}> = ({ className, shape = "bars" }) => (
  <div
    aria-hidden
    data-chart-ghost={shape}
    className={cn(
      "relative overflow-hidden rounded-xl border bg-card",
      className,
    )}
  >
    <svg
      className="absolute inset-x-6 bottom-6 top-8 h-[calc(100%-3.5rem)] w-[calc(100%-3rem)]"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <line
        x1={0}
        x2={100}
        y1={100}
        y2={100}
        stroke="hsl(var(--border))"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {shape === "bars"
        ? BARS.map((h, i) => {
            const w = 100 / BARS.length;
            return (
              <rect
                key={i}
                x={i * w + w * 0.2}
                y={100 - h}
                width={w * 0.6}
                height={h}
                rx={1}
                fill="hsl(var(--muted))"
              />
            );
          })
        : null}
    </svg>
    {shape === "dots" ? (
      // A second, UNSCALED layer: the plot above stretches to the card (`preserveAspectRatio=
      // "none"`), which is harmless for bars but turns round dots into dashes on a wide card.
      // Percentage positions with a pixel radius stay round at every aspect ratio.
      <svg className="absolute inset-x-6 bottom-6 top-8 h-[calc(100%-3.5rem)] w-[calc(100%-3rem)] overflow-visible">
        {DOTS.map(([x, y], i) => (
          <circle
            key={i}
            cx={`${x}%`}
            cy={`${y}%`}
            r={4}
            fill="hsl(var(--muted))"
          />
        ))}
      </svg>
    ) : null}
    <div className="motion-shimmer pointer-events-none absolute inset-0" />
  </div>
);
