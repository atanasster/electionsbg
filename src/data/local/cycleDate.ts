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

/** "2026-06-14" → "14.06.2026". ISO date as published in the chmi history
 *  feed; returns the input untouched when it can't be parsed. */
export const friendlyIsoDate = (iso: string): string => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
};

export type LocalCycleKind = "regular" | "partial";

/**
 * What KIND of vote a local cycle slug names — read off the folder name, which
 * is the only place it is recorded: `src/data/json/local_elections.json` lists
 * the regular cycles ONLY, so a `.find()` there returns undefined for every
 * partial and cannot be used to classify one.
 *
 * The chmi test runs FIRST on purpose. `2024_06_23_chmi` also ends in "mi", so
 * an `endsWith("_mi")` (or worse, an `includes("mi")`) reached first would call
 * every by-election a general election. On the settlement and município pages
 * that mislabels a частичен избор as „редовен вот"; in `scripts/person/localTerms`
 * — which re-exports this — it would retire every mandate in the country on the
 * day one village voted.
 *
 * Returns null for anything not shaped like a local cycle folder (a
 * parliamentary slug, a typo), so callers decide rather than inherit a guess.
 */
export const localCycleKind = (cycle: string): LocalCycleKind | null => {
  if (/_chmi(_nov)?$/.test(cycle)) return "partial";
  if (/_mi$/.test(cycle)) return "regular";
  return null;
};
