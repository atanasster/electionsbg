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

export const useSchools = (obshtina?: string | null) => {
  const { data } = useQuery({
    queryKey: ["schools"],
    queryFn: fetchSchools,
    staleTime: Infinity,
  });
  const schools = obshtina ? (data?.schoolsByObshtina[obshtina] ?? []) : [];
  return { data, schools };
};
