import { CSSProperties, FC } from "react";

import { cn } from "@/lib/utils";

/**
 * A held slot: the shape of content that has not arrived yet.
 *
 * Pass the size in `className` — the caller owns the geometry, because the
 * point of a skeleton is to be the SAME size as the thing that replaces it, and
 * only the caller knows that. Where the loaded element has a fixed height
 * (`h-[200px]`, a chart's viewBox), reuse that exact value rather than a
 * lookalike; where it does not, reserving nothing beats reserving a guess,
 * since a wrong reservation is still a layout shift — just in the other
 * direction.
 *
 * `motion-reduce:animate-none` because a pulsing block is decoration, and a
 * reader who has asked for less motion should get a plain one.
 */
export const Skeleton: FC<{
  className?: string;
  /** For a height that lives in a JS constant — e.g. a chart's viewBox height,
   *  where the point is to read the SAME value the chart does. */
  style?: CSSProperties;
}> = ({ className, style }) => (
  <div
    aria-hidden
    style={style}
    className={cn(
      "animate-pulse rounded bg-muted/40 motion-reduce:animate-none",
      className,
    )}
  />
);
