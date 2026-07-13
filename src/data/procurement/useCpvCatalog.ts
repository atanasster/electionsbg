// The named CPV-code catalogue (from the tenders feed's cpv_desc) — the only
// source of code→name beyond the 2-digit division titles in cpvSectors. Powers
// the searchable CPV filter on the contracts browser. ~3.6k codes, fetched once.

import { useQuery } from "@tanstack/react-query";

export type CpvCatalogEntry = { cpv: string; desc: string };

const fetchCpvCatalog = async (): Promise<CpvCatalogEntry[]> => {
  const r = await fetch("/api/db/cpv-catalog");
  if (!r.ok) return [];
  return (await r.json()) as CpvCatalogEntry[];
};

export const useCpvCatalog = () =>
  useQuery({
    queryKey: ["cpv-catalog"] as const,
    queryFn: fetchCpvCatalog,
    staleTime: Infinity,
  });
