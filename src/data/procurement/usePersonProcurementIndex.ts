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
import { useProcurementWindow } from "./useProcurementWindow";

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

const fetchScanner = async (
  from: string | null,
  to: string | null,
): Promise<PersonIndexFile | null> => {
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const r = await fetch(`/api/db/procurement-scanner?${qs.toString()}`);
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
  return (await r.json()) as PersonIndexFile;
};

// DB-backed (/api/db/procurement-scanner → procurement_scanner): the full
// political-class procurement index, scoped to the selected parliament window or
// the full corpus (?pscope).
export const usePersonProcurementIndex = (): {
  rows: PersonProcurementRow[];
  isLoading: boolean;
} => {
  const { from, to } = useProcurementWindow();
  const { data, isLoading } = useQuery({
    queryKey: ["procurement", "scanner", from, to],
    queryFn: () => fetchScanner(from, to),
    staleTime: Infinity,
  });
  return { rows: data?.rows ?? [], isLoading };
};

// Window-independent (full-corpus) variant for the combined search box, so a
// person match doesn't vanish when the scope narrows. Shares the query cache
// with the scanner page's "all years" mode. `enabled` gates the fetch to the
// first focus/keystroke — the dashboard doesn't pay for it up front.
export const useCorpusPersonIndex = (
  enabled: boolean,
): PersonProcurementRow[] => {
  const { data } = useQuery({
    queryKey: ["procurement", "scanner", null, null],
    queryFn: () => fetchScanner(null, null),
    staleTime: Infinity,
    enabled,
  });
  return data?.rows ?? [];
};
