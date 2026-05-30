// Resolve which local-election cycle to show given the selected parliamentary
// election date.
//
// Local government composition is anchored in time to the selected
// parliamentary election: the local dashboards show the most recent *regular*
// local cycle that had already concluded by the selected parliamentary date —
// i.e. "what did local government look like at that moment". Partial (chmi)
// re-elections are overlaid separately by useChmiHistory, which applies the
// same date cutoff (drops events with date > selected).
//
// Pure function — mirrors the date-cutoff discipline already used by
// useChmiHistory and the cabinet-anchor snapshot re-anchoring. No React.

import allLocalElections from "@/data/json/local_elections.json";

export type LocalCycleCatalogEntry = {
  name: string; // e.g. "2023_10_29_mi"
  round1Date: string; // "2023-10-29"
  round2Date: string | null;
  kind: "regular" | "partial";
};

export type LocalAsOf = {
  cycle: string; // resolved cycle folder name
  round1Date: string;
  round2Date: string | null;
  // True when the selected parliamentary date precedes the oldest ingested
  // regular cycle, so we clamped to the oldest available rather than showing
  // an empty state.
  clampedToOldest: boolean;
};

// Parliamentary selected "YYYY_MM_DD" → ISO "YYYY-MM-DD". Uses a regex replace
// rather than String.replaceAll so it stays within the app's ES2020 lib target.
const toIso = (d?: string): string | undefined =>
  d ? d.replace(/_/g, "-") : undefined;

// Regular cycles only, newest first. Partials never anchor a dashboard — they
// surface contextually via the chmi feed / per-município chmi section.
const REGULAR: LocalCycleCatalogEntry[] = (
  allLocalElections as LocalCycleCatalogEntry[]
)
  .filter((e) => e.kind === "regular")
  .slice()
  .sort((a, b) => b.round1Date.localeCompare(a.round1Date));

/**
 * Pick the regular local cycle in effect as of the selected parliamentary
 * election date. With no selection, defaults to the newest cycle.
 */
export const localAsOf = (selectedDate?: string): LocalAsOf => {
  const asOf = toIso(selectedDate);
  const newest = REGULAR[0];
  const oldest = REGULAR[REGULAR.length - 1];
  if (!asOf) {
    return {
      cycle: newest.name,
      round1Date: newest.round1Date,
      round2Date: newest.round2Date,
      clampedToOldest: false,
    };
  }
  // Most recent regular cycle whose first round had concluded by the selected
  // date (REGULAR is newest-first, so the first hit is the latest applicable).
  const match = REGULAR.find((e) => e.round1Date <= asOf);
  if (match) {
    return {
      cycle: match.name,
      round1Date: match.round1Date,
      round2Date: match.round2Date,
      clampedToOldest: false,
    };
  }
  // Selected predates the oldest ingested cycle → clamp to oldest available.
  return {
    cycle: oldest.name,
    round1Date: oldest.round1Date,
    round2Date: oldest.round2Date,
    clampedToOldest: true,
  };
};
