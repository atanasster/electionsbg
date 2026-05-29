// Per-oblast land-use composition (data/landuse/index.json) — sourced
// from NSI's annual "Баланс на територията" press-release annex,
// which itself is computed off АГКК's digital cadastral map.
//
// Granularity is 28 oblasts. The frontend resolves the app's wider
// oblast vocabulary (Sofia stolitsa МИРs S23/S24/S25, Plovdiv city
// PDV-00) back to the NSI canonical code via APP_TO_NSI_OBLAST below.
//
// Sizing: ~3.9 KB gzipped (14.7 KB raw) for all 28 oblasts + national
// + per-year metadata. Intentionally NOT sharded per-oblast: a slice
// would be ~500 bytes (smaller than HTTP request/response headers),
// React Query already dedupes the single fetch across every tile that
// mounts on /my-area/:id, and the payload is fetched lazily only on
// routes that mount this hook. Re-evaluate if the file ever exceeds
// ~50 KB gzipped (e.g. adding a long historical series).

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export const CATEGORY_KEYS = [
  "urbanized",
  "transport",
  "agricultural",
  "forest",
  "water",
  "protected",
  "disturbed",
  "unclassified",
] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export type LandUseOblast = {
  nameBg: string;
  nameEn: string;
  totalKm2: number;
  byCategoryKm2: Record<CategoryKey, number>;
  byCategoryPct: Record<CategoryKey, number>;
  popDensityTotal: number;
  popDensityUrbanized: number;
  popDensityExclWater: number;
};

export type LandUseYear = {
  publishedAt: string;
  pdfUrl: string;
  national: LandUseOblast;
  oblasts: Record<string, LandUseOblast>;
};

export type LandUseCategory = {
  key: CategoryKey;
  bg: string;
  en: string;
};

export type LandUseFile = {
  source: { name: string; nameEn: string; url: string };
  fetchedAt: string;
  latestYear: number;
  categories: LandUseCategory[];
  years: Record<string, LandUseYear>;
};

// Map the app's full oblast vocabulary onto NSI's 28-code grain.
// The 28 canonical codes pass through identity; the additional codes
// the codebase uses for МИР / sub-oblast aggregations collapse onto
// the matching NSI row.
const APP_TO_NSI_OBLAST: Record<string, string> = {
  // Sofia stolitsa city — the codebase splits it into 3 МИРs that
  // each share NSI's single "SOF" row (Sofia (stolitsa)).
  S23: "SOF",
  S24: "SOF",
  S25: "SOF",
  // Plovdiv oblast — the codebase has a synthetic "PDV-00" for the
  // city. NSI publishes one row for the oblast as a whole.
  "PDV-00": "PDV",
};

export const resolveNsiOblast = (
  appOblast: string | null | undefined,
): string | null => {
  if (!appOblast) return null;
  return APP_TO_NSI_OBLAST[appOblast] ?? appOblast;
};

const fetchLandUse = async (): Promise<LandUseFile> => {
  const r = await fetch(dataUrl("/landuse/index.json"));
  if (!r.ok) throw new Error("landuse fetch failed");
  return r.json();
};

export const useLandUse = (oblast?: string | null) => {
  const { data } = useQuery({
    queryKey: ["landuse"],
    queryFn: fetchLandUse,
    staleTime: Infinity,
  });
  const latestYear = data?.latestYear ?? null;
  const year = latestYear != null ? data?.years[String(latestYear)] : undefined;
  const code = resolveNsiOblast(oblast);
  const oblastRow = code && year ? year.oblasts[code] : undefined;
  return { data, year, oblastRow, latestYear, nsiCode: code };
};
