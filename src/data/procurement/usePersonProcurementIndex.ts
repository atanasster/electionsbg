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
import { useElectionContext } from "@/data/ElectionContext";
import { useProcurementScope } from "./useProcurementScope";

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

const fetchIndex = async (url: string): Promise<PersonIndexFile | null> => {
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as PersonIndexFile;
};

export const usePersonProcurementIndex = (): {
  rows: PersonProcurementRow[];
  isLoading: boolean;
} => {
  const { scope } = useProcurementScope();
  const { selected } = useElectionContext();
  const ns = scope === "ns";
  // ns → the per-election scanner index (by_ns/people/<date>.json); all → the
  // full-corpus index.
  const url = ns
    ? dataUrl(`/procurement/by_ns/people/${selected}.json`)
    : dataUrl("/procurement/derived/person_procurement_index.json");
  const { data, isLoading } = useQuery({
    queryKey: ["procurement", "person_index", ns ? `ns:${selected}` : "all"],
    queryFn: () => fetchIndex(url),
    staleTime: Infinity,
  });
  return { rows: data?.rows ?? [], isLoading };
};
