// The per-unit competition colour band: relative to the
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

/** Text colour per band — shared by every tile that colours a share with
 *  `bandOf`, so one band never reads in two colours on two pages. */
export const BAND_TEXT: Record<Band, string> = {
  below: "text-emerald-600 dark:text-emerald-400",
  above: "text-amber-600 dark:text-amber-400",
  wellAbove: "text-red-600 dark:text-red-400",
  neutral: "text-foreground",
};
