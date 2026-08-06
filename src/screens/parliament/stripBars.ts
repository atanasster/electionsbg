// The session strip's bar geometry, extracted from the component so the arithmetic can be
// tested. It is not decoration: this is where the strip's two encodings — height for volume,
// colour for the outcome split — are reconciled, and getting that wrong produces a picture
// that is wrong rather than ugly.
//
// THE DEFECT THIS FILE EXISTS TO PREVENT. The first draft computed the segments against the
// RAW height and then rendered the bar at `Math.max(height, 8)`, with the abstain span as
// `flex-1`. So on any bar short enough for the minimum-height clamp to fire, the abstain
// segment silently absorbed the whole shortfall. Worked example from the 52nd, whose peak is a
// 219-item budget day: a 1-item sitting with yes 200 / no 10 / abstain 5 gives a raw height of
// 4 px, clamped to 8 — за takes 4, против 0, and „въздържали се" is handed the remaining 4.
// Half the column painted as abstention where the true share is 2.3%. The clamp fires for
// every sitting under ~1.9% of peak, which on the 52nd means every day under five items —
// including its own last one.

import type { StripDay } from "./stripWindow";

/** Tallest bar in pixels, and the minimum a sitting is drawn at so it stays distinguishable
 *  from the hairline that marks a day the chamber did not sit. */
const MAX_BAR_PX = 58;
const MIN_BAR_PX = 8;

export interface BarGeometry {
  /** The height the bar is actually RENDERED at — the clamp already applied. */
  height: number;
  /** Segment heights in pixels, summing to exactly `height`. Null when the day carries no
   *  split, in which case the caller draws one solid bar. */
  segments: { yes: number; no: number; abstain: number } | null;
  /** The same split as FRACTIONS of the day's cast votes — what the pixels are rounded from,
   *  and the only form of this figure the strip may DISPLAY.
   *
   *  The raw counts must never be shown. They are votes summed over every item of the
   *  sitting, not members: the 52nd's budget day is 219 items, so its tally reads
   *  „за 15 961" for a chamber of 240. Printed beside a date that is off by two orders of
   *  magnitude and reads as a headcount — which is exactly what shipped in the first
   *  tooltip, one commit after hub_feed.ts documented the trap and said the two should
   *  agree "by construction rather than by anyone remembering to keep them in step".
   *  Returning the shares from the same function that draws the pixels is that
   *  construction. */
  shares: { yes: number; no: number; abstain: number } | null;
  /** Cast votes that day — the denominator the shares are of. Also not for display. */
  cast: number;
}

/** Geometry for one column.
 *
 *  SQUARE-ROOT scale, not linear. Item counts per day are long-tailed — the 52nd ranges from 1
 *  to 237 — so a linear scale draws a 14-item sitting as a 4 px sliver indistinguishable from a
 *  non-sitting day, which is the one comparison the strip exists to make. Ordering is
 *  unchanged; only the contrast between small values is. */
export const barGeometry = (day: StripDay, peak: number): BarGeometry => {
  const raw =
    peak > 0 ? Math.round(Math.sqrt(day.items / peak) * MAX_BAR_PX) : 0;
  const height = Math.max(raw, MIN_BAR_PX);
  const cast = day.tally ? day.tally.yes + day.tally.no + day.tally.abstain : 0;
  if (!day.tally || cast === 0)
    return { height, segments: null, shares: null, cast: 0 };
  const shares = {
    yes: day.tally.yes / cast,
    no: day.tally.no / cast,
    abstain: day.tally.abstain / cast,
  };
  // Scaled against the RENDERED height, and the last segment takes the remainder rather than
  // its own rounding — so the three always sum to exactly `height` and no column shows a
  // hairline of card colour where three roundings fell short.
  const yes = Math.max(0, Math.round(shares.yes * height));
  const no = Math.max(0, Math.round(shares.no * height));
  const abstain = Math.max(0, height - yes - no);
  return { height, segments: { yes, no, abstain }, shares, cast };
};

/** The three colours, declared once. The legend above the strip and the segments inside it
 *  read the same map, so a legend cannot end up explaining colours the bars do not use. */
export const SEGMENT_CLASS = {
  yes: "bg-[hsl(var(--primary))]",
  no: "bg-rose-500",
  abstain: "bg-muted-foreground/45",
} as const;
