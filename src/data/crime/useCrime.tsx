// Monthly crime tallies by oblast (МВР publication). Empty until
// `update-crime-stats` runs (see scripts/crime/README.md).

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type CrimeCategory =
  | "property"
  | "violent"
  | "drugs"
  | "traffic"
  | "fraud"
  | "other";

export type CrimeFile = {
  source: string;
  indexName: string;
  grain: "oblast";
  categories: Record<CrimeCategory, { bg: string; en: string }>;
  /** Keyed by oblast 3-letter code → month "YYYY-MM" → category → count. */
  monthlyByOblast: Record<
    string,
    Record<string, Partial<Record<CrimeCategory, number>>>
  >;
  latestMonth: string | null;
  note?: string;
};

const fetchCrime = async (): Promise<CrimeFile> => {
  const r = await fetch(dataUrl("/crime/index.json"));
  if (!r.ok) throw new Error("crime fetch failed");
  return r.json();
};

export const useCrime = (oblast?: string | null) => {
  const { data } = useQuery({
    queryKey: ["crime"],
    queryFn: fetchCrime,
    staleTime: Infinity,
  });
  const monthly = oblast ? data?.monthlyByOblast[oblast] : undefined;
  return { data, monthly };
};
