/**
 * Assemble per-indicator normalized rows into the final data/indicators.json
 * payload and write per-municipality slices under data/indicators/<code>.json
 * for the tile (1-2 KB per page-fetch vs. the 200+ KB bundle the choropleth
 * consumes). See src/data/indicators/useIndicators.tsx for consumer types.
 */

import fs from "fs";
import path from "path";
import type { NormalizeOutput } from "./normalize";

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
  indicators: Record<string, IndicatorMeta>;
  /** series[indicatorId][obshtinaCode] = annual time series, ascending. */
  series: Record<string, Record<string, IndicatorPoint[]>>;
};

/** Per-municipality slice consumed by the dashboard tile. Carries the same
 * indicator metadata as the bundle (so the tile is self-contained) plus
 * just this muni's series. Sofia districts get a copy of the SOF00 series
 * with `fallback: "sofia-city"` so a single fetch suffices on those pages. */
export type IndicatorMuniSlice = {
  fetchedAt: string;
  obshtinaCode: string;
  indicators: Record<string, IndicatorMeta>;
  series: Record<string, IndicatorPoint[]>;
  fallback?: "sofia-city";
};

export type IndicatorBuild = {
  id: string;
  meta: Omit<IndicatorMeta, "years">;
  rows: NormalizeOutput[];
};

const dedupeAndSort = (
  rows: NormalizeOutput[],
): Record<string, IndicatorPoint[]> => {
  // For each (muni, year) the last write wins. Annual reviews from later
  // years republish the prior year's value; the later publication is the
  // canonical one (revisions happen).
  const perMuni: Map<string, Map<number, number>> = new Map();
  for (const r of rows) {
    if (!perMuni.has(r.obshtinaCode)) perMuni.set(r.obshtinaCode, new Map());
    perMuni.get(r.obshtinaCode)!.set(r.year, r.value);
  }
  const out: Record<string, IndicatorPoint[]> = {};
  for (const [muni, perYear] of perMuni) {
    const series: IndicatorPoint[] = Array.from(perYear, ([year, value]) => ({
      year,
      value,
    })).sort((a, b) => a.year - b.year);
    out[muni] = series;
  }
  return out;
};

const yearRange = (
  byMuni: Record<string, IndicatorPoint[]>,
): [number, number] => {
  let lo = Infinity;
  let hi = -Infinity;
  for (const series of Object.values(byMuni)) {
    for (const p of series) {
      if (p.year < lo) lo = p.year;
      if (p.year > hi) hi = p.year;
    }
  }
  return [Number.isFinite(lo) ? lo : 0, Number.isFinite(hi) ? hi : 0];
};

export const buildPayload = (builds: IndicatorBuild[]): IndicatorsPayload => {
  const indicators: Record<string, IndicatorMeta> = {};
  const series: Record<string, Record<string, IndicatorPoint[]>> = {};
  for (const b of builds) {
    const byMuni = dedupeAndSort(b.rows);
    series[b.id] = byMuni;
    indicators[b.id] = { ...b.meta, years: yearRange(byMuni) };
  }
  return {
    fetchedAt: new Date().toISOString(),
    indicators,
    series,
  };
};

// Sofia city aggregate code. The 24 districts (S23xx/S24xx/S25xx) don't
// appear in source data; the tile uses the city-wide SOF00 series for all
// of them via the fallback flag. Keep in sync with the hook in
// src/data/indicators/useIndicators.tsx.
const SOFIA_CITY_KEY = "SOF00";

const loadSofiaDistrictCodes = (muniFile: string): string[] => {
  const munis = JSON.parse(fs.readFileSync(muniFile, "utf8")) as {
    obshtina: string;
    oblast: string;
  }[];
  return munis
    .filter((m) => ["S23", "S24", "S25"].includes(m.oblast))
    .map((m) => m.obshtina);
};

/**
 * Walk the assembled payload and write per-muni slices to `outDir`. Each
 * slice carries the indicator metadata so the tile is self-contained.
 * Also writes Sofia-district copies pointing to SOF00 so muni pages for
 * those codes don't 404 / round-trip.
 *
 * Returns the list of written slice codes (for caller logging).
 */
export const writeMuniSlices = (
  payload: IndicatorsPayload,
  outDir: string,
  muniFile: string,
): string[] => {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Gather every muni code that has at least one indicator series.
  const allCodes = new Set<string>();
  for (const byMuni of Object.values(payload.series)) {
    for (const code of Object.keys(byMuni)) allCodes.add(code);
  }

  const written: string[] = [];

  for (const code of allCodes) {
    const series: Record<string, IndicatorPoint[]> = {};
    for (const [id, byMuni] of Object.entries(payload.series)) {
      const pts = byMuni[code];
      if (pts && pts.length > 0) series[id] = pts;
    }
    if (Object.keys(series).length === 0) continue;
    const slice: IndicatorMuniSlice = {
      fetchedAt: payload.fetchedAt,
      obshtinaCode: code,
      indicators: payload.indicators,
      series,
    };
    fs.writeFileSync(path.join(outDir, `${code}.json`), JSON.stringify(slice));
    written.push(code);
  }

  // Sofia-district fallbacks: copy SOF00's series under the district code
  // with the fallback flag set. The tile then reads one file regardless of
  // page.
  const sofiaSeries: Record<string, IndicatorPoint[]> = {};
  for (const [id, byMuni] of Object.entries(payload.series)) {
    const pts = byMuni[SOFIA_CITY_KEY];
    if (pts && pts.length > 0) sofiaSeries[id] = pts;
  }
  if (Object.keys(sofiaSeries).length > 0) {
    const sofiaDistricts = loadSofiaDistrictCodes(muniFile);
    for (const dcode of sofiaDistricts) {
      const slice: IndicatorMuniSlice = {
        fetchedAt: payload.fetchedAt,
        obshtinaCode: dcode,
        indicators: payload.indicators,
        series: sofiaSeries,
        fallback: "sofia-city",
      };
      fs.writeFileSync(
        path.join(outDir, `${dcode}.json`),
        JSON.stringify(slice),
      );
      written.push(dcode);
    }
  }

  return written;
};
