// Per-oblast join for the НОИ pension choropleths (/pensions view). The pension
// file already carries one row per oblast (average pension + cash-vs-bank share)
// for each year, so — unlike the procurement/НЗОК choropleths — there is no
// population normalisation to do here; this hook only bridges the pension oblast
// codes to the region map's canonical feature codes.
//
// The pension codes are the canonical oblast codes (SOF = София-град/capital,
// SFO = София rural oblast, PDV = Пловдив, …). The Sofia-merged region map keys
// its capital polygon nuts3 "SOF" and folds it to "SOFIA_CITY" via featureToCanon
// (which also folds Пловдив's PDV-00 → PDV). Running the pension row codes through
// the SAME featureToCanon puts both sides in one key space: pension "SOF"
// (capital) → "SOFIA_CITY" (the merged Sofia-city feature) and pension "SFO"
// (rural oblast) stays "SFO" — a SEPARATE feature the merged map keeps whole. So
// the two Sofia values never collide even though the map merges the three Sofia
// city МИР into one polygon.

import { useMemo } from "react";
import { featureToCanon } from "@/data/procurement/useProcurementByOblast";
import type { NoiPensionOblastRow, NoiPensionsFile } from "./types";

export const useNoiPensionsRegional = (
  data: NoiPensionsFile | null | undefined,
): {
  /** The year the rows below describe (the file's latest), or null. */
  year: number | null;
  /** Oblast rows for `year` (empty when the file/year is missing). */
  rows: NoiPensionOblastRow[];
  /** Rows keyed by canonical feature code (featureToCanon space). */
  byCanon: Map<string, NoiPensionOblastRow>;
  /** Resolve a region-map feature's nuts3 code to its pension row. */
  rowForFeature: (featureCode: string) => NoiPensionOblastRow | undefined;
} => {
  const year = data?.latestYear ?? null;

  const rows = useMemo<NoiPensionOblastRow[]>(() => {
    if (!data || year == null) return [];
    return data.oblasts[year] ?? [];
  }, [data, year]);

  const byCanon = useMemo(() => {
    const out = new Map<string, NoiPensionOblastRow>();
    for (const r of rows) out.set(featureToCanon(r.code), r);
    return out;
  }, [rows]);

  const rowForFeature = useMemo(() => {
    return (featureCode: string): NoiPensionOblastRow | undefined =>
      byCanon.get(featureToCanon(featureCode));
  }, [byCanon]);

  return { year, rows, byCanon, rowForFeature };
};
