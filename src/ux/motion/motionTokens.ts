// Motion tokens — the ONE place durations and curves are named.
//
// The rule every consumer follows (docs/plans/motion-v1.md §1): MOTION MEANS STATE. Nothing
// animates on first paint — the prerendered page is the page, and a count-up from zero on load
// is theatre that costs LCP and asserts nothing. Things move when the reader CHANGED something
// (an election, a `?pscope`, a metric) or when the data itself is new. Between those, stillness.
//
// The CSS half lives in `src/index.css` as `--motion-*` custom properties with the same values,
// so a keyframe and a JS tween started together finish together.

/** Milliseconds. Three steps, no others: a value that needs a fourth is usually a sign the
 *  animation is doing a job the layout should be doing. */
export const MOTION_MS = {
  /** Hover, focus, a colour settling. */
  fast: 120,
  /** A region re-filling, a mark appearing. */
  base: 240,
  /** A number rolling, a line drawing on — anything the eye should FOLLOW. */
  slow: 480,
} as const;

/** Decelerating: fast out of the gate, gentle landing. The default for everything that
 *  arrives; matches `--motion-ease-out`. */
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
