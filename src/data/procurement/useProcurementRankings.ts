// Full procurement rankings for the standalone "see all" screens
// (/procurement/contractors, /awarders, /mps) — DB-backed
// (/api/db/procurement-rankings → procurement_rankings()). The big-list
// sibling of useProcurementOverview: complete top lists (contractors and
// awarders capped at 1000, MPs/officials unlimited), window-scoped to the
// current procurement scope (?pscope) like every other procurement page.

import { useQuery } from "@tanstack/react-query";
import { useProcurementWindow } from "./useProcurementWindow";
import type {
  ProcurementByNsTopAwarder,
  ProcurementByNsTopMp,
  ProcurementByNsTopOfficial,
  ProcurementTopContractorEntry,
} from "@/data/dataTypes";

export type ProcurementRankings = {
  start: string | null;
  end: string | null;
  topContractors: ProcurementTopContractorEntry[];
  topAwarders: ProcurementByNsTopAwarder[];
  topMps: ProcurementByNsTopMp[];
  topOfficials: ProcurementByNsTopOfficial[];
};

export const useProcurementRankings = () => {
  const { from, to, all } = useProcurementWindow();

  const query = useQuery({
    queryKey: ["db", "procurement-rankings", from, to] as const,
    queryFn: async (): Promise<ProcurementRankings> => {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const r = await fetch(`/api/db/procurement-rankings?${qs.toString()}`);
      if (!r.ok) throw new Error(`rankings fetch failed: ${r.status}`);
      return (await r.json()) as ProcurementRankings;
    },
    staleTime: Infinity,
  });

  return { ...query, from, to, all };
};
