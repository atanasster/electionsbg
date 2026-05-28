// Per-oblast crime rates from МВР (via the BG government open-data-viz
// repo). Coverage 2000–2015 in this first cut — see scripts/crime/README
// for why the current monthly bulletins on mvr.bg are deferred.
//
// Rates are normalised per 10,000 inhabitants (the "perth" suffix in the
// upstream filenames). Using rates instead of raw counts makes
// cross-oblast comparison meaningful — a smaller oblast with high
// per-capita crime ranks correctly alongside Sofia city.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type CrimeCategoryKey =
  | "total"
  | "against_person"
  | "against_property"
  | "generally_dangerous"
  | "other"
  | "deaths_no_violence";

export type CrimeYearRecord = Partial<Record<CrimeCategoryKey, number>>;

export type CrimeFile = {
  source: string;
  sourceUrl: string;
  indexName: string;
  grain: "oblast";
  unit: "per_10k";
  coverageYears: [number, number];
  categories: Record<CrimeCategoryKey, { bg: string; en: string }>;
  /** Keyed by oblast 3-letter code → year "YYYY" → category → rate. */
  yearlyByOblast: Record<string, Record<string, CrimeYearRecord>>;
  latestYear: string;
  note?: string;
};

const fetchCrime = async (): Promise<CrimeFile> => {
  const r = await fetch(dataUrl("/crime/index.json"));
  if (!r.ok) throw new Error("crime fetch failed");
  return r.json();
};

// Sofia районы share Sofia city's stats under S23. Mirror the fallback
// pattern used in the other tile hooks so all 24 районy see citywide data.
const SOFIA_CITY_KEY = "S23";
const isSofiaDistrict = (oblast: string): boolean =>
  /^S2[3-5]\d{2}$/i.test(oblast);

export const useCrime = (oblast?: string | null) => {
  const { data } = useQuery({
    queryKey: ["crime"],
    queryFn: fetchCrime,
    staleTime: Infinity,
  });
  if (!oblast) return { data, yearly: undefined };
  let yearly = data?.yearlyByOblast[oblast];
  if (!yearly && isSofiaDistrict(oblast)) {
    yearly = data?.yearlyByOblast[SOFIA_CITY_KEY];
  }
  return { data, yearly };
};
