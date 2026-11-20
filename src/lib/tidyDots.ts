/** A compact € amount ends in an abbreviation's own period („€4,7 млрд.") —
 *  a sentence that ends on one must not add a second. Collapses a doubled
 *  period (never an ellipsis). */
export const tidyDots = (s: string): string =>
  s.replace(/(?<!\.)\.\.(?!\.)/g, ".");
