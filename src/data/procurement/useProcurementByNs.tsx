// Fetches the per-election pre-aggregated procurement slice for the
// currently-selected election. Used by /procurement when scoped to one NS.
// The "see all years" toggle on that screen falls back to the unscoped
// index.json + top_contractors.json files instead.

import { useQuery } from "@tanstack/react-query";
import { useElectionContext } from "@/data/ElectionContext";
import { dataUrl } from "@/data/dataUrl";
import type { ProcurementByNsFile } from "@/data/dataTypes";

const fetchByNs = async (
  electionDate: string,
): Promise<ProcurementByNsFile | null> => {
  const r = await fetch(dataUrl(`/procurement/by_ns/${electionDate}.json`));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as ProcurementByNsFile;
};

export const useProcurementByNs = () => {
  const { selected } = useElectionContext();
  return useQuery({
    queryKey: ["procurement", "by_ns", selected] as const,
    queryFn: () => fetchByNs(selected),
    enabled: !!selected,
    staleTime: Infinity,
  });
};
