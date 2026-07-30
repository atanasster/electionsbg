// The named CPV-code catalogue (from the tenders feed's cpv_desc) — the only
// source of code→name beyond the 2-digit division titles in cpvSectors. Powers
// the searchable CPV filter on the contracts browser. ~3.6k codes, fetched once.

import { useQuery } from "@tanstack/react-query";

export type CpvCatalogEntry = { cpv: string; desc: string };

const fetchCpvCatalog = async (): Promise<CpvCatalogEntry[]> => {
  const r = await fetch("/api/db/cpv-catalog");
  // THROW, do not return []. An empty array is a legitimate answer ("the
  // catalogue has no codes"), so returning it on a failed request made a 500
  // indistinguishable from an empty catalogue — and the CPV filter came up
  // silently blank with nothing to retry. That is exactly what happened while
  // this route was a full corpus scan timing out on prod: users saw an empty
  // picker, not an error. React Query can retry a throw; it cannot retry a lie.
  if (!r.ok) throw new Error(`cpv-catalog: ${r.status}`);
  return (await r.json()) as CpvCatalogEntry[];
};

export const useCpvCatalog = () =>
  useQuery({
    queryKey: ["cpv-catalog"] as const,
    queryFn: fetchCpvCatalog,
    staleTime: Infinity,
  });
