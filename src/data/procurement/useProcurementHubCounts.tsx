// Secondary counts for the /procurement hub stat tiles that aren't in the
// overview payload (tenders + КЗК appeals, windowed to ?pscope; NGOs all-time).
// A separate, cheap DB call (/api/db/procurement-hub-counts) so the tiles fill
// in without bloating the hot procurement-overview function.

import { useQuery } from "@tanstack/react-query";
import { useProcurementWindow } from "./useProcurementWindow";

export interface ProcurementHubCounts {
  tenders: number;
  appeals: number;
  /** All-time distinct funded NGOs — ngo_funding has no date, so scope-agnostic. */
  ngos: number;
}

export const useProcurementHubCounts = () => {
  const { from, to } = useProcurementWindow();
  return useQuery({
    queryKey: ["procurement", "hub-counts", from, to] as const,
    queryFn: async (): Promise<ProcurementHubCounts> => {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const r = await fetch(`/api/db/procurement-hub-counts?${qs.toString()}`);
      if (!r.ok) throw new Error(`hub-counts fetch failed: ${r.status}`);
      return r.json();
    },
    staleTime: Infinity,
  });
};
