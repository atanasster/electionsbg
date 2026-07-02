// Procurement dashboard overview, DB-backed (/api/db/procurement-overview →
// procurement_overview). Replaces the static index.json / by_ns/<date>.json
// fetch: the same ProcurementByNsFile shape, computed live and scoped to a
// window. The window is the selected parliament's tenure [start, next election)
// — elections.json is newest-first, so the next (more recent) election sits at
// the previous index. Scope "all" (?pscope=all) drops the window → full corpus.

import { useQuery } from "@tanstack/react-query";
import { useProcurementWindow } from "./useProcurementWindow";
import type { ProcurementByNsFile } from "@/data/dataTypes";

export const useProcurementOverview = () => {
  const { from, to, all, selected } = useProcurementWindow();

  const query = useQuery({
    queryKey: ["procurement", "overview", from, to] as const,
    queryFn: async (): Promise<ProcurementByNsFile> => {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const r = await fetch(`/api/db/procurement-overview?${qs.toString()}`);
      if (!r.ok) throw new Error(`overview fetch failed: ${r.status}`);
      const j = (await r.json()) as Omit<
        ProcurementByNsFile,
        "electionDate" | "start" | "end" | "generatedAt"
      >;
      return {
        electionDate: selected,
        start: from ?? "",
        end: to,
        generatedAt: "",
        ...j,
      };
    },
    staleTime: Infinity,
  });

  return { ...query, from, to, all };
};
