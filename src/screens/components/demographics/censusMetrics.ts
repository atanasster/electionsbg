import type { CensusMetric } from "@/data/census/censusTypes";

export type MetricKind = "absolute" | "percentage";
export type MetricScale = "sequential" | "diverging";

export type MetricDef = {
  key: CensusMetric;
  i18nKey: string;
  i18nGroup: string;
  kind: MetricKind;
  // For percentage metrics: a sensible diverging midpoint (national avg)
  // can be supplied at render time; we use sequential by default.
  scale: MetricScale;
};

export const CENSUS_METRICS: MetricDef[] = [
  {
    key: "population",
    i18nKey: "census_metric_population",
    i18nGroup: "census_group_population",
    kind: "absolute",
    scale: "sequential",
  },
  {
    key: "ageUnder15",
    i18nKey: "census_metric_age_under15",
    i18nGroup: "census_group_population",
    kind: "percentage",
    scale: "sequential",
  },
  {
    key: "age15_29",
    i18nKey: "census_metric_age_15_29",
    i18nGroup: "census_group_population",
    kind: "percentage",
    scale: "sequential",
  },
  {
    key: "age30_44",
    i18nKey: "census_metric_age_30_44",
    i18nGroup: "census_group_population",
    kind: "percentage",
    scale: "sequential",
  },
  {
    key: "age45_64",
    i18nKey: "census_metric_age_45_64",
    i18nGroup: "census_group_population",
    kind: "percentage",
    scale: "sequential",
  },
  {
    key: "age65plus",
    i18nKey: "census_metric_age_65plus",
    i18nGroup: "census_group_population",
    kind: "percentage",
    scale: "sequential",
  },
  {
    key: "genderFemale",
    i18nKey: "census_metric_gender_female",
    i18nGroup: "census_group_population",
    kind: "percentage",
    scale: "sequential",
  },
  {
    key: "ethnicBulgarian",
    i18nKey: "census_metric_ethnic_bulgarian",
    i18nGroup: "census_group_ethnic",
    kind: "percentage",
    scale: "sequential",
  },
  {
    key: "ethnicTurkish",
    i18nKey: "census_metric_ethnic_turkish",
    i18nGroup: "census_group_ethnic",
    kind: "percentage",
    scale: "sequential",
  },
  {
    key: "ethnicRoma",
    i18nKey: "census_metric_ethnic_roma",
    i18nGroup: "census_group_ethnic",
    kind: "percentage",
    scale: "sequential",
  },
  {
    key: "religionChristian",
    i18nKey: "census_metric_religion_christian",
    i18nGroup: "census_group_religion",
    kind: "percentage",
    scale: "sequential",
  },
  {
    key: "religionMuslim",
    i18nKey: "census_metric_religion_muslim",
    i18nGroup: "census_group_religion",
    kind: "percentage",
    scale: "sequential",
  },
  {
    key: "religionNoneOrUndecl",
    i18nKey: "census_metric_religion_none",
    i18nGroup: "census_group_religion",
    kind: "percentage",
    scale: "sequential",
  },
  {
    key: "eduTertiary",
    i18nKey: "census_metric_edu_tertiary",
    i18nGroup: "census_group_education",
    kind: "percentage",
    scale: "sequential",
  },
  {
    key: "eduSecondary",
    i18nKey: "census_metric_edu_secondary",
    i18nGroup: "census_group_education",
    kind: "percentage",
    scale: "sequential",
  },
  {
    key: "eduPrimaryOrLower",
    i18nKey: "census_metric_edu_primary_or_lower",
    i18nGroup: "census_group_education",
    kind: "percentage",
    scale: "sequential",
  },
  {
    key: "employmentRate",
    i18nKey: "census_metric_employment_rate",
    i18nGroup: "census_group_employment",
    kind: "percentage",
    scale: "sequential",
  },
  {
    key: "unemploymentRate",
    i18nKey: "census_metric_unemployment_rate",
    i18nGroup: "census_group_employment",
    kind: "percentage",
    scale: "sequential",
  },
  {
    key: "activityRate",
    i18nKey: "census_metric_activity_rate",
    i18nGroup: "census_group_employment",
    kind: "percentage",
    scale: "sequential",
  },
];

export const METRIC_BY_KEY: Record<CensusMetric, MetricDef> =
  Object.fromEntries(CENSUS_METRICS.map((m) => [m.key, m])) as Record<
    CensusMetric,
    MetricDef
  >;

export const formatMetricValue = (
  value: number | undefined,
  metric: CensusMetric,
  lang: string,
): string => {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const def = METRIC_BY_KEY[metric];
  if (!def) return String(value);
  if (def.kind === "absolute") {
    return value.toLocaleString(lang === "bg" ? "bg-BG" : "en-GB");
  }
  return `${(value * 100).toFixed(1)}%`;
};

// Sequential interpolation between two HSL endpoints, given a 0..1 t.
const lerpHsl = (
  t: number,
  from: [number, number, number],
  to: [number, number, number],
) => {
  const h = from[0] + (to[0] - from[0]) * t;
  const s = from[1] + (to[1] - from[1]) * t;
  const l = from[2] + (to[2] - from[2]) * t;
  return `hsl(${h.toFixed(0)}, ${s.toFixed(0)}%, ${l.toFixed(0)}%)`;
};

// Map a 0..1 normalized value to a Viridis-ish blue-purple ramp.
export const sequentialColor = (t: number): string => {
  if (!Number.isFinite(t)) return "hsl(0, 0%, 80%)";
  const clamped = Math.max(0, Math.min(1, t));
  // Light pale yellow → deep indigo
  return lerpHsl(clamped, [50, 90, 90], [255, 70, 30]);
};
