// TI-BG Local Integrity System Index — per-município composite + 9 pillars.
//
// File ships with an empty `scoresByObshtina` until the
// `update-municipal-transparency` skill runs (see
// scripts/transparency/README.md). Until then the hook returns `undefined`
// and the consuming tile renders nothing — silent cutover when data lands.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type MunicipalTransparencyPillarKey =
  | "procurement_transparency"
  | "budget_transparency"
  | "council_oversight"
  | "conflict_of_interest"
  | "citizen_participation"
  | "audit"
  | "asset_declarations"
  | "public_data"
  | "integrity_response";

export type MunicipalTransparencyScore = {
  composite: number;
  pillars: Partial<Record<MunicipalTransparencyPillarKey, number>>;
  nationalRank: number;
};

export type MunicipalTransparencyFile = {
  source: string;
  sourceUrl: string;
  indexName: string;
  year: number | null;
  nationalAverage: number | null;
  /** TI-BG publishes LISI on a 0-5 scale. The tile reads .max for the
   *  "/ N" suffix; older scaffold defaulted this to 10. */
  scoreScale?: { min: number; max: number };
  pillarLabels: Record<
    MunicipalTransparencyPillarKey,
    { bg: string; en: string }
  >;
  scoresByObshtina: Record<string, MunicipalTransparencyScore>;
  note?: string;
};

const fetchTransparency = async (): Promise<MunicipalTransparencyFile> => {
  const r = await fetch(dataUrl("/municipal_transparency/index.json"));
  if (!r.ok) throw new Error("transparency fetch failed");
  return r.json();
};

/** Returns the score record for an obshtina, or `undefined` if the
 *  município isn't in the index (or the data isn't ingested yet). */
export const useMunicipalTransparency = (obshtina?: string | null) => {
  const { data } = useQuery({
    queryKey: ["municipal_transparency"],
    queryFn: fetchTransparency,
    staleTime: Infinity,
    // The index is small (~30 KB for 265 entries) and read by ≥1 tile per
    // page view once the scrape lands — keep the cache forever.
  });
  const score = obshtina ? data?.scoresByObshtina[obshtina] : undefined;
  return { data, score };
};
