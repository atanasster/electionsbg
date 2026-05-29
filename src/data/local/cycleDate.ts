// Shared utilities for local-elections tiles. Kept tiny so the tile
// files don't drift on the same formatting/colour decisions.

/** Default swatch colour for parties whose canonical id can't be
 *  resolved — used as the fallback throughout the local-government
 *  tiles so unresolved coalitions render with a single, recognisable
 *  neutral grey. Tailwind neutral-400. */
export const UNRESOLVED_PARTY_COLOR = "#9ca3af";

/** "2023_10_29_mi" → "29.10.2023". Cycle slugs follow the YYYY_MM_DD
 *  convention used throughout the data tree. Returns the input
 *  untouched when the prefix can't be parsed. */
export const friendlyCycleDate = (cycle: string): string => {
  const m = cycle.match(/^(\d{4})_(\d{2})_(\d{2})/);
  if (!m) return cycle;
  return `${m[3]}.${m[2]}.${m[1]}`;
};
