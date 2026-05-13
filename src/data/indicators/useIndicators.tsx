import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

// Indicator identifiers. Adding a new annual indicator (DZI, EU funds,
// healthcare, ...) means:
//   1. Add a SOURCES entry in scripts/indicators/fetch.ts.
//   2. Add the id here.
//   3. Add an entry to DELTA_KIND below.
//   4. Add a formatter rule in formatIndicatorValue if the default
//      "round to two decimals" isn't right.
export type IndicatorId = "unemployment" | "dzi" | "populationChange";

export type IndicatorPoint = { year: number; value: number };

export type IndicatorMeta = {
  labelBg: string;
  labelEn: string;
  unitBg: string;
  unitEn: string;
  cadence: "annual";
  source: { name: string; url: string };
  years: [number, number];
};

export type IndicatorsPayload = {
  fetchedAt: string;
  indicators: Record<IndicatorId, IndicatorMeta>;
  /** series[indicatorId][obshtinaCode] = annual time series, ascending. */
  series: Record<IndicatorId, Record<string, IndicatorPoint[]>>;
};

const fetchJson = async <T,>(path: string): Promise<T | undefined> => {
  const res = await fetch(dataUrl(path));
  if (!res.ok) return undefined;
  return (await res.json()) as T;
};

export const useIndicators = () =>
  useQuery({
    queryKey: ["indicators"],
    queryFn: () => fetchJson<IndicatorsPayload>("/indicators.json"),
  });

/** Per-municipality slice fetched by the dashboard tile. ~2 KB per page vs.
 * the 200+ KB bundle the choropleth needs. Sofia districts (S23xx/S24xx/
 * S25xx) get pre-baked slices pointing to the SOF00 city aggregate with
 * `fallback: "sofia-city"` set, so the tile reads one file regardless of
 * page. */
export type IndicatorMuniSlice = {
  fetchedAt: string;
  obshtinaCode: string;
  indicators: Record<IndicatorId, IndicatorMeta>;
  series: Record<IndicatorId, IndicatorPoint[]>;
  fallback?: IndicatorFallback;
};

export const useIndicatorSlice = (obshtinaCode: string | undefined) =>
  useQuery({
    queryKey: ["indicators_slice", obshtinaCode],
    enabled: !!obshtinaCode,
    queryFn: () =>
      fetchJson<IndicatorMuniSlice>(`/indicators/${obshtinaCode}.json`),
  });

/** Compute latest values + YoY delta straight from a per-muni slice. The
 * slice already carries only this muni's series, so no global lookup
 * needed. Returns the same `IndicatorLatest` shape as the bundle-based
 * `selectIndicatorsForMuni` for drop-in tile compatibility. */
export const selectIndicatorsFromSlice = (
  slice: IndicatorMuniSlice | undefined,
): IndicatorLatest[] => {
  if (!slice) return [];
  const out: IndicatorLatest[] = [];
  for (const id of Object.keys(slice.series) as IndicatorId[]) {
    const series = slice.series[id];
    if (!series || series.length === 0) continue;
    const latest = series[series.length - 1];
    const prior = series.length >= 2 ? series[series.length - 2] : undefined;
    const deltaKind = DELTA_KIND[id];
    let yoyDelta: number | undefined;
    if (prior) {
      if (deltaKind === "absolute") {
        yoyDelta = latest.value - prior.value;
      } else if (prior.value !== 0) {
        yoyDelta = ((latest.value - prior.value) / Math.abs(prior.value)) * 100;
      }
    }
    out.push({
      key: id,
      meta: slice.indicators[id],
      latest,
      prior,
      yoyDelta,
      deltaKind,
      fallback: slice.fallback,
    });
  }
  return out;
};

// Per-indicator delta semantics. Unemployment is a rate that can move
// modestly across years, so the YoY delta is shown as an absolute
// percentage-point change ("-0.5 pp"), not a relative percent change.
export type IndicatorDeltaKind = "percent" | "absolute";

const DELTA_KIND: Record<IndicatorId, IndicatorDeltaKind> = {
  unemployment: "absolute",
  dzi: "absolute",
  populationChange: "absolute",
};

export const indicatorDeltaKind = (key: IndicatorId): IndicatorDeltaKind =>
  DELTA_KIND[key];

// Per-indicator direction: when the metric goes UP, is that good or bad?
// Unemployment rising is bad → tile colors a positive delta red and the
// choropleth's dark end represents the highest value (most distressed).
// DZI rising is good → opposite.
const HIGHER_IS_BETTER: Record<IndicatorId, boolean> = {
  unemployment: false,
  dzi: true,
  populationChange: true,
};

export const indicatorHigherIsBetter = (key: IndicatorId): boolean =>
  HIGHER_IS_BETTER[key];

export const formatIndicatorValue = (value: number | undefined): string => {
  if (value === undefined || !Number.isFinite(value)) return "—";
  // All current indicators are % values with one decimal of useful precision.
  // Specialize per IndicatorId here once a second indicator with different
  // units (e.g. лв./жител for wages) lands.
  return value.toFixed(1);
};

export type IndicatorFallback = "sofia-city";

export type IndicatorLatest = {
  key: IndicatorId;
  meta: IndicatorMeta;
  latest: IndicatorPoint;
  prior?: IndicatorPoint;
  yoyDelta?: number;
  deltaKind: IndicatorDeltaKind;
  /** True when the value came from the Sofia city aggregate (SOF00) rather
   * than a per-district key. The tile renders a footnote in this case. */
  fallback?: IndicatorFallback;
};

// Sofia city aggregate key. See scripts/indicators/normalize.ts and
// data/indicators.json — Sofia districts (S2301..S2524) are absent from
// public AZ data, so we store the city aggregate once and fall back here.
const SOFIA_CITY_KEY = "SOF00";

const isSofiaDistrict = (obshtinaCode: string): boolean =>
  /^S2[3-5]\d{2}$/i.test(obshtinaCode);

/**
 * Resolve all indicators for the given obshtina code. Falls back to the
 * Sofia city aggregate for any Sofia-district code that doesn't have a
 * direct entry in the series (which is all of them, today).
 */
export const selectIndicatorsForMuni = (
  payload: IndicatorsPayload | undefined,
  obshtinaCode: string | undefined,
): IndicatorLatest[] => {
  if (!payload || !obshtinaCode) return [];
  const out: IndicatorLatest[] = [];
  for (const id of Object.keys(payload.series) as IndicatorId[]) {
    let series = payload.series[id]?.[obshtinaCode];
    let fallback: IndicatorFallback | undefined;
    if ((!series || series.length === 0) && isSofiaDistrict(obshtinaCode)) {
      series = payload.series[id]?.[SOFIA_CITY_KEY];
      if (series && series.length > 0) fallback = "sofia-city";
    }
    if (!series || series.length === 0) continue;
    const latest = series[series.length - 1];
    const prior = series.length >= 2 ? series[series.length - 2] : undefined;
    const deltaKind = DELTA_KIND[id];
    let yoyDelta: number | undefined;
    if (prior) {
      if (deltaKind === "absolute") {
        yoyDelta = latest.value - prior.value;
      } else if (prior.value !== 0) {
        yoyDelta = ((latest.value - prior.value) / Math.abs(prior.value)) * 100;
      }
    }
    out.push({
      key: id,
      meta: payload.indicators[id],
      latest,
      prior,
      yoyDelta,
      deltaKind,
      fallback,
    });
  }
  return out;
};

/** Pull a single indicator's series for a muni, with Sofia fallback. */
export const selectIndicatorSeries = (
  payload: IndicatorsPayload | undefined,
  id: IndicatorId,
  obshtinaCode: string | undefined,
): { points: IndicatorPoint[]; fallback?: IndicatorFallback } => {
  if (!payload || !obshtinaCode) return { points: [] };
  let series = payload.series[id]?.[obshtinaCode];
  let fallback: IndicatorFallback | undefined;
  if ((!series || series.length === 0) && isSofiaDistrict(obshtinaCode)) {
    series = payload.series[id]?.[SOFIA_CITY_KEY];
    if (series && series.length > 0) fallback = "sofia-city";
  }
  return { points: series ?? [], fallback };
};
