/**
 * Prior-vintage protection for data/indicators.json.
 *
 * Upstream sources are not append-only. data.egov.bg's МОН ДЗИ dataset is a
 * rolling window of ~10 resources, so a new session pushes the oldest off it
 * (2026-10-03: the 2021/22 primary session — our 2022, 240 munis — left). The
 * row-count floors in fetch.ts (minMunis, median years per muni) cannot see a
 * lost YEAR: 2023..2026 alone clear both comfortably. Two defences live here:
 *
 *  - `carryPriorYears` re-adds, from the committed file, every year a source
 *    has stopped returning. Used only for sources that opt in (`carryPriorVintage`)
 *    — the value was true when published and the source simply no longer lists it.
 *  - `findShrinkage` compares a freshly built payload against the committed one
 *    and reports every indicator that lost a year (or vanished). fetch.ts refuses
 *    to write on any finding unless --allow-shrink is passed.
 */

import fs from "fs";
import type { IndicatorsPayload } from "./build";
import type { NormalizeOutput } from "./normalize";

export const loadCommitted = (file: string): IndicatorsPayload | undefined => {
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8")) as IndicatorsPayload;
};

/** Years with at least one muni value, per the series (not the meta range,
 * which would hide a hole in the middle). */
export const seriesYears = (
  byMuni: Record<string, { year: number }[]> | undefined,
): Set<number> => {
  const out = new Set<number>();
  for (const pts of Object.values(byMuni ?? {}))
    for (const p of pts) out.add(p.year);
  return out;
};

export type CarryResult = {
  rows: NormalizeOutput[];
  /** year → muni count carried from the prior vintage. */
  carried: Map<number, number>;
};

/**
 * Add the prior vintage's points for every year absent from `fresh`. A year the
 * source still returns is taken wholly from the source (revisions win); only
 * whole missing years are carried, never individual munis within a fresh year.
 */
export const carryPriorYears = (
  fresh: NormalizeOutput[],
  prior: Record<string, { year: number; value: number }[]> | undefined,
): CarryResult => {
  const freshYears = new Set(fresh.map((r) => r.year));
  const carried = new Map<number, number>();
  const rows = [...fresh];
  for (const [obshtinaCode, pts] of Object.entries(prior ?? {})) {
    for (const p of pts) {
      if (freshYears.has(p.year)) continue;
      rows.push({ obshtinaCode, year: p.year, value: p.value });
      carried.set(p.year, (carried.get(p.year) ?? 0) + 1);
    }
  }
  return { rows, carried };
};

export type Shrinkage = {
  id: string;
  /** Empty with `missingIndicator` set when the indicator vanished entirely. */
  lostYears: number[];
  missingIndicator?: boolean;
};

export const findShrinkage = (
  next: IndicatorsPayload,
  committed: IndicatorsPayload | undefined,
): Shrinkage[] => {
  if (!committed) return [];
  const out: Shrinkage[] = [];
  for (const id of Object.keys(committed.series)) {
    if (!(id in next.series)) {
      out.push({ id, lostYears: [], missingIndicator: true });
      continue;
    }
    const have = seriesYears(next.series[id]);
    const lost = [...seriesYears(committed.series[id])]
      .filter((y) => !have.has(y))
      .sort((a, b) => a - b);
    if (lost.length) out.push({ id, lostYears: lost });
  }
  return out;
};
