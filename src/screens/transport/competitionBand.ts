// The per-unit competition colour band (transport-hub-v1 A10): relative to the
// same-window national rate, never a fixed threshold.

/** Points above the national rate at which a bar turns red. */
export const WELL_ABOVE = 0.15;

export type Band = "below" | "above" | "wellAbove" | "neutral";
/** Shares are compared at the precision they are SHOWN (one decimal of a percent),
 *  so a body reading the same figure as the national rate is never coloured above it. */
const tenths = (v: number) => Math.round(v * 1000);
export const bandOf = (s: number, national: number | null): Band =>
  national == null
    ? "neutral"
    : tenths(s) <= tenths(national)
      ? "below"
      : tenths(s) <= tenths(national + WELL_ABOVE)
        ? "above"
        : "wellAbove";
