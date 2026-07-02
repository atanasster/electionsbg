// Full-corpus top-contractors list — DB-backed (/api/db/procurement-rankings
// with no window → procurement_rankings(NULL, NULL)). Kept in the old
// ProcurementTopContractorsFile shape so consumers are unchanged.

import { useQuery } from "@tanstack/react-query";
import type { ProcurementTopContractorsFile } from "@/data/dataTypes";

const fetchTop = async (): Promise<ProcurementTopContractorsFile | null> => {
  const r = await fetch("/api/db/procurement-rankings");
  if (!r.ok) return null;
  const j = (await r.json()) as {
    topContractors: ProcurementTopContractorsFile["entries"];
  };
  return {
    generatedAt: "",
    total: j.topContractors.length,
    entries: j.topContractors,
  };
};

// `enabled` lets a consumer already showing per-NS data (the overview) skip the
// full-corpus fetch.
export const useTopContractors = (enabled = true) =>
  useQuery({
    queryKey: ["db", "procurement-rankings", null, null, "top"] as const,
    queryFn: fetchTop,
    enabled,
    staleTime: Infinity,
  });
