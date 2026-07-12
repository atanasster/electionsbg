// National CPV-division totals ("what does the state buy"), DB-backed
// (/api/db/procurement-sectors → procurement_sectors), scoped to the selected
// parliament window / year or the full corpus (?pscope). Divisions are 2-digit
// CPV prefixes, labelled via cpvDivisionName.

import { useQuery } from "@tanstack/react-query";
import { useScopeWindow } from "@/data/scope/useScopeWindow";

export type ProcurementSectorsFile = {
  totalEur: number;
  uncoded: { eur: number; n: number };
  sectors: Array<{ division: string; eur: number; n: number }>;
};

export const useProcurementSectors = () => {
  const { from, to } = useScopeWindow();
  return useQuery({
    queryKey: ["procurement", "sectors", from, to],
    queryFn: async (): Promise<ProcurementSectorsFile | null> => {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const r = await fetch(`/api/db/procurement-sectors?${qs.toString()}`);
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      return (await r.json()) as ProcurementSectorsFile;
    },
    staleTime: Infinity,
  });
};
