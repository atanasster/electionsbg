// Person → procurement index for the "public money scanner" (/procurement/
// people). Loads the slim, pre-aggregated derived/person_procurement_index.json
// (one row per person, ~20 KB) instead of the two full cross-reference files
// (mp_connected.json ≈108 KB + pep_connected.json ≈72 KB), keeping the
// scanner's payload minimal. Scoped to the political class we resolve with
// confidence: MPs (from mp_connected.json) + non-MP officials — cabinet,
// agency heads, governors, mayors, deputy-mayors, councillors (from
// pep_connected.json, HIGH-confidence links only). Each row carries a `kind`
// discriminator; MPs drill into /candidate/mp-<id>/procurement, officials
// into /officials/<slug>.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type PersonProcurementRow = {
  kind: "mp" | "official";
  name: string;
  totalEur: number;
  contractorCount: number;
  contractCount: number;
  /** present when kind === "mp" */
  mpId?: number;
  /** present when kind === "official" */
  slug?: string;
  tier?: string;
  role?: string;
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
