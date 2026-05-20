import type { CensusEntity, CensusMetric } from "@/data/census/censusTypes";

export const PERCENT_METRICS: CensusMetric[] = [
  "ethnicBulgarian",
  "ethnicTurkish",
  "ethnicRoma",
  "religionChristian",
  "religionMuslim",
  "religionNoneOrUndecl",
  "eduTertiary",
  "eduSecondary",
  "eduPrimaryOrLower",
  "ageUnder15",
  "age65plus",
  "employmentRate",
  "unemploymentRate",
  "activityRate",
];

// Pearson correlation. Returns 0 when sample is too small or variance is 0.
export const pearson = (xs: number[], ys: number[]): number => {
  const n = xs.length;
  if (n < 3) return 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
};

// Absolute count for a metric (numerator of the share). Returns undefined for
// rate-only metrics (employment/activity/unemployment) where NSI publishes
// only a percentage.
export const censusMetricCount = (
  e: CensusEntity | undefined,
  metric: CensusMetric,
): number | undefined => {
  if (!e) return undefined;
  switch (metric) {
    case "ethnicBulgarian":
      return e.ethnic?.bulgarian;
    case "ethnicTurkish":
      return e.ethnic?.turkish;
    case "ethnicRoma":
      return e.ethnic?.roma;
    case "religionChristian":
      return e.religion?.christian;
    case "religionMuslim":
      return e.religion?.muslim;
    case "religionNoneOrUndecl":
      return e.religion?.noReligion;
    case "eduTertiary":
      return e.education?.tertiary;
    case "eduSecondary":
      return e.education
        ? e.education.upperSecondary + e.education.tertiary
        : undefined;
    case "eduPrimaryOrLower":
      return e.education?.primaryOrLower;
    case "ageUnder15":
      return e.age?.age0_14;
    case "age65plus":
      return e.age?.age65plus;
    default:
      return undefined;
  }
};
