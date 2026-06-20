// Person → procurement index for the "public money scanner" (/procurement/
// people). Loads the slim, pre-aggregated derived/person_procurement_index.json
// (one row per MP, ~12 KB) instead of the full mp_connected.json (~108 KB),
// keeping the scanner's payload minimal. Scoped to the political class we
// resolve with confidence (MPs today; officials are a follow-up).

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type PersonProcurementRow = {
  mpId: number;
  mpName: string;
  totalEur: number;
  contractorCount: number;
  contractCount: number;
};

type PersonIndexFile = {
  generatedAt: string;
  total: number;
  rows: PersonProcurementRow[];
};

const fetchIndex = async (): Promise<PersonIndexFile | null> => {
  const r = await fetch(
    dataUrl("/procurement/derived/person_procurement_index.json"),
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as PersonIndexFile;
};

export const usePersonProcurementIndex = (): {
  rows: PersonProcurementRow[];
  isLoading: boolean;
} => {
  const { data, isLoading } = useQuery({
    queryKey: ["procurement", "person_index"] as const,
    queryFn: fetchIndex,
    staleTime: Infinity,
  });
  return { rows: data?.rows ?? [], isLoading };
};
