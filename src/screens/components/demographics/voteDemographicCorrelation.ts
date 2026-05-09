import type {
  CensusMetric,
  CensusOblastEntity,
} from "@/data/census/censusTypes";
import { censusMetricValue } from "@/data/census/useCensus";
import { NUTS3_TO_OBLAST } from "@/data/census/oblastJoin";
import type { ElectionRegion } from "@/data/dataTypes";

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
  e: CensusOblastEntity | undefined,
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

export type OblastVoteAggregate = {
  oblastCode: string;
  partyVotes: number;
  totalVotes: number;
};

// Aggregate election-region rows (including Sofia's three MIRs and the
// PDV/PDV-00 split) by NSI oblast code, summing party + total votes per
// oblast. Mirrors the joining the scatter does so correlations stay
// consistent with the chart.
export const aggregateOblastVotes = (
  regions: ElectionRegion[] | undefined,
  partyNum: number | undefined,
): Map<string, OblastVoteAggregate> => {
  const out = new Map<string, OblastVoteAggregate>();
  if (!regions || partyNum === undefined) return out;
  for (const region of regions) {
    const oblastCode = NUTS3_TO_OBLAST[region.nuts3];
    if (!oblastCode) continue;
    const partyV = region.results.votes.find((v) => v.partyNum === partyNum);
    const total = region.results.votes.reduce((s, v) => s + v.totalVotes, 0);
    const entry = out.get(oblastCode) ?? {
      oblastCode,
      partyVotes: 0,
      totalVotes: 0,
    };
    entry.partyVotes += partyV?.totalVotes ?? 0;
    entry.totalVotes += total;
    out.set(oblastCode, entry);
  }
  return out;
};

export type MetricCorrelation = {
  metric: CensusMetric;
  r: number;
  n: number;
};

// Compute the Pearson r of party-vote-share vs each demographic metric across
// all 28 oblasts. Returned in PERCENT_METRICS order; callers sort as needed.
export const computeMetricCorrelations = (
  oblasts: CensusOblastEntity[] | undefined,
  voteAgg: Map<string, OblastVoteAggregate>,
): MetricCorrelation[] => {
  if (!oblasts || voteAgg.size === 0) return [];
  const yShares: { code: string; y: number }[] = [];
  for (const [code, agg] of voteAgg) {
    if (agg.totalVotes <= 0) continue;
    yShares.push({ code, y: (agg.partyVotes / agg.totalVotes) * 100 });
  }
  return PERCENT_METRICS.map((metric) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const { code, y } of yShares) {
      const entity = oblasts.find((o) => o.code === code);
      const xRaw = censusMetricValue(entity, metric);
      if (xRaw === undefined) continue;
      xs.push(xRaw * 100);
      ys.push(y);
    }
    return { metric, r: pearson(xs, ys), n: xs.length };
  });
};
