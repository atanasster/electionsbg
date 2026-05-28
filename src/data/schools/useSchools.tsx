// Per-school НВО + ДЗИ scores. Empty until `update-schools` runs (see
// scripts/schools/README.md). Hook returns an empty array for any
// município until then.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type SchoolSubjectKey = "nvo_bel" | "nvo_math" | "dzi_bel" | "dzi_math";

export type SchoolRecord = {
  id: string;
  name: string;
  type?: "primary" | "secondary" | "mixed";
  address?: string;
  loc?: string;
  scoresByYear: Record<string, Partial<Record<SchoolSubjectKey, number>>>;
};

export type SchoolsFile = {
  source: string;
  sourceUrl: string;
  indexName: string;
  latestYear: number | null;
  subjects: Record<SchoolSubjectKey, { bg: string; en: string }>;
  schoolsByObshtina: Record<string, SchoolRecord[]>;
  note?: string;
};

const fetchSchools = async (): Promise<SchoolsFile> => {
  const r = await fetch(dataUrl("/schools/index.json"));
  if (!r.ok) throw new Error("schools fetch failed");
  return r.json();
};

// Sofia районы (S23xx/S24xx/S25xx) have no per-район slice in the schools
// dataset — МОН publishes Столична община as a single SOF00 aggregate.
// Fall back from район code to SOF00 so Sofia районы see all Столична
// schools instead of an empty tile. Same pattern as useIndicators.
const SOFIA_CITY_KEY = "SOF00";
const isSofiaDistrict = (obshtina: string): boolean =>
  /^S2[3-5]\d{2}$/i.test(obshtina);

export const useSchools = (obshtina?: string | null) => {
  const { data } = useQuery({
    queryKey: ["schools"],
    queryFn: fetchSchools,
    staleTime: Infinity,
  });
  if (!obshtina) return { data, schools: [] as SchoolRecord[] };
  let schools = data?.schoolsByObshtina[obshtina] ?? [];
  if (schools.length === 0 && isSofiaDistrict(obshtina)) {
    schools = data?.schoolsByObshtina[SOFIA_CITY_KEY] ?? [];
  }
  return { data, schools };
};
