import type { CensusMetric } from "@/data/census/censusTypes";

// Shared row-selection for the demographic-cleavages dot plots (parliamentary
// DemographicCleavagesTile + local LocalDemographicCleavagesTile).
//
// Headline cleavages are the sharpest dividing lines, ranked by spread.
// Sub-0.6 spreads are visual noise; age and sex are weaker electoral
// cleavages than ethnicity / religion / education, so the spread ranking
// alone never surfaces them. Sex and the single strongest voting-age band are
// therefore pinned in below the headline rows; the under-15 band (non-voting)
// and the near-flat middle bands are left to the /demographics explorer.
const MAX_ROWS = 8;
const SPREAD_THRESHOLD = 0.6;

const VOTING_AGE_METRICS: CensusMetric[] = [
  "age15_29",
  "age30_44",
  "age45_64",
  "age65plus",
];
const PINNED_OR_HIDDEN = new Set<CensusMetric>([
  ...VOTING_AGE_METRICS,
  "ageUnder15",
  "genderFemale",
]);

export const selectCleavageRows = <
  T extends { metric: CensusMetric; spread: number },
>(
  rows: T[],
): T[] => {
  const headline = rows
    .filter(
      (r) => !PINNED_OR_HIDDEN.has(r.metric) && r.spread >= SPREAD_THRESHOLD,
    )
    .slice(0, MAX_ROWS);
  const sex = rows.find((r) => r.metric === "genderFemale");
  const strongestAgeBand = rows
    .filter((r) => VOTING_AGE_METRICS.includes(r.metric))
    .sort((a, b) => b.spread - a.spread)[0];
  return [
    ...headline,
    ...(sex ? [sex] : []),
    ...(strongestAgeBand ? [strongestAgeBand] : []),
  ];
};
