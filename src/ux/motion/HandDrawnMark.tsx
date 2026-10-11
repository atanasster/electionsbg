import { FC, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useInView } from "@/ux/useInView";
import { handDrawnUnderlinePath } from "./handDrawn";

// The editorial pen mark for HTML (motion-v1 §3.6): underline THE figure a block is about,
// drawn on once it scrolls into view. The HTML twin of the loop on flipped map regions.
//
// ⚠️ ONE PER BLOCK, AND ONLY ON A FIGURE THE PAGE ALREADY SINGLES OUT. A mark is a claim that
// this number matters more than its neighbours; sprinkled, it stops meaning anything. Use it
// where the copy already says so — a figure set in its own colour, a headline total.
//
// The stroke is `currentColor`, so the mark takes the colour the figure is already set in (the
// rose of a deficit, the emerald of a surplus) and adds no new encoding. It is decoration over
// text the reader already has, hence aria-hidden.

export const HandDrawnMark: FC<{
  children: ReactNode;
  /** Something stable about what is marked, so the wobble is the same on every render. */
  seed: string;
  className?: string;
}> = ({ children, seed, className }) => {
  const { ref, inView } = useInView<HTMLSpanElement>("0px");
  // Hidden until it is on screen, then drawn on; under reduced motion `.motion-draw-on` shows
  // the finished stroke at once.
  const strokeClass = inView ? "motion-draw-on" : "opacity-0";
  return (
    <span ref={ref} className={cn("relative inline-block", className)}>
      {children}
      <svg
        aria-hidden
        className="pointer-events-none absolute -bottom-2 left-0 h-2.5 w-full overflow-visible"
        viewBox="0 0 100 10"
        preserveAspectRatio="none"
      >
        <path
          className={strokeClass}
          d={handDrawnUnderlinePath(seed)}
          pathLength={1}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
  );
};
