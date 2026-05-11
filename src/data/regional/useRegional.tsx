import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type RegionalIndicatorKey =
  | "gdpPerCapita"
  | "population"
  | "netMigration";

export type RegionalPoint = { year: number; value: number };

export type RegionalIndicatorMeta = {
  titleEn: string;
  titleBg: string;
  unitLabelEn: string;
  unitLabelBg: string;
  sourceUrl: string;
  datasetCode: string;
};

export type RegionalPayload = {
  source: { name: string; url: string };
  fetchedAt: string;
  country: string;
  indicators: Record<RegionalIndicatorKey, RegionalIndicatorMeta>;
  series: Record<RegionalIndicatorKey, Record<string, RegionalPoint[]>>;
};

const fetchJson = async <T,>(path: string): Promise<T | undefined> => {
  const res = await fetch(dataUrl(path));
  if (!res.ok) return undefined;
  return (await res.json()) as T;
};

export const useRegional = () =>
  useQuery({
    queryKey: ["regional"],
    queryFn: () => fetchJson<RegionalPayload>("/regional.json"),
  });

// Per-indicator display formatter. Net migration is already a signed rate
// (per 1000) so we always show the sign and one decimal. GDP / population
// are absolute counts, formatted with locale-aware thousand separators.
export const formatRegionalValue = (
  key: RegionalIndicatorKey,
  value: number | undefined,
  lang: string,
): string => {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const locale = lang === "bg" ? "bg-BG" : "en-GB";
  if (key === "netMigration") {
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(1)}`;
  }
  return Math.round(value).toLocaleString(locale);
};

export type RegionalDeltaKind = "percent" | "absolute";

export type RegionalLatest = {
  key: RegionalIndicatorKey;
  meta: RegionalIndicatorMeta;
  latest: RegionalPoint;
  prior?: RegionalPoint;
  yoyDelta?: number;
  // Whether yoyDelta is a percent change (e.g. GDP rose 7.8%) or an absolute
  // change in the same unit as the value (e.g. net migration rate fell 2.8
  // per 1000). Rate-style indicators that can cross zero (net migration)
  // use absolute change so we don't show misleading hundreds-percent swings.
  deltaKind?: RegionalDeltaKind;
};

const DELTA_KIND: Record<RegionalIndicatorKey, RegionalDeltaKind> = {
  gdpPerCapita: "percent",
  population: "percent",
  netMigration: "absolute",
};

// Compute the latest value + YoY delta for each indicator at the given oblast.
// Returns an empty array when the payload isn't ready or the oblast has no
// indicator coverage.
export const selectLatestForOblast = (
  payload: RegionalPayload | undefined,
  oblastCode: string | undefined,
): RegionalLatest[] => {
  if (!payload || !oblastCode) return [];
  const out: RegionalLatest[] = [];
  for (const key of Object.keys(payload.series) as RegionalIndicatorKey[]) {
    const series = payload.series[key]?.[oblastCode];
    if (!series || series.length === 0) continue;
    const latest = series[series.length - 1];
    const prior = series.length >= 2 ? series[series.length - 2] : undefined;
    const deltaKind = DELTA_KIND[key];
    let yoyDelta: number | undefined;
    if (prior) {
      if (deltaKind === "absolute") {
        yoyDelta = latest.value - prior.value;
      } else if (prior.value !== 0) {
        yoyDelta = ((latest.value - prior.value) / Math.abs(prior.value)) * 100;
      }
    }
    out.push({
      key,
      meta: payload.indicators[key],
      latest,
      prior,
      yoyDelta,
      deltaKind,
    });
  }
  return out;
};
