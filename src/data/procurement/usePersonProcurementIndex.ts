// Person → procurement index for the combined search box's person matches.
// DB-backed (/api/db/procurement-scanner → procurement_scanner): the full
// political-class procurement index. Scoped to the political class we
// resolve with confidence: MPs (from mp_connected.json) + non-MP officials —
// cabinet, agency heads, governors, mayors, deputy-mayors, councillors (from
// pep_connected.json, HIGH-confidence links only). Each row carries a `kind`
// discriminator; MPs drill into /candidate/mp-<id>/procurement, officials
// into /officials/<slug>.

import { useQuery } from "@tanstack/react-query";

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

// Window-independent (full-corpus) so a person match doesn't vanish when the
// dashboard's scope narrows. `enabled` gates the fetch to the first
// focus/keystroke — the dashboard doesn't pay for it up front.
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
