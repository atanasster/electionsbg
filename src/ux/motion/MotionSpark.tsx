import { FC } from "react";
import { cn } from "@/lib/utils";

// The freshness spark — a small hand-drawn asterisk in the accent colour (coral in light,
// mint in dark).
//
// ⚠️ IT MOVES ONLY WHEN IT MEANS SOMETHING. It flutters a few times when it appears beside
// something genuinely new, then rests — a resting spark still says „new", a perpetually
// spinning one says nothing and costs a compositor layer forever. Callers decide WHEN it is
// shown (e.g. `isFreshlySeen`); the component never animates on its own initiative, and under
// prefers-reduced-motion it is simply still (index.css).
//
// The rays are deliberately unequal: a ruler-straight star reads as an icon font, an uneven
// one reads as a mark someone made.
const RAYS: [number, number][] = [
  [0, 6.2],
  [47, 5.4],
  [92, 6.6],
  [137, 5.1],
  [183, 6.0],
  [226, 5.6],
  [272, 6.4],
  [316, 5.2],
];

export const MotionSpark: FC<{
  /** Accessible name; omit when adjacent text already says the same thing. */
  label?: string;
  className?: string;
}> = ({ label, className }) => (
  <svg
    viewBox="-8 -8 16 16"
    className={cn("motion-spark inline-block h-3 w-3 shrink-0", className)}
    role={label ? "img" : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
  >
    {RAYS.map(([deg, len]) => {
      const a = (deg * Math.PI) / 180;
      return (
        <line
          key={deg}
          x1={0}
          y1={0}
          x2={Math.round(Math.cos(a) * len * 100) / 100}
          y2={Math.round(Math.sin(a) * len * 100) / 100}
          stroke="hsl(var(--accent))"
          strokeWidth={1.9}
          strokeLinecap="round"
        />
      );
    })}
  </svg>
);
