// Per-election (per-NS) procurement slice for the currently-selected election
// — DB-backed (/api/db/procurement-overview → procurement_overview()), always
// scoped to the selected parliament's tenure regardless of ?pscope. Shares the
// overview query cache, so a page mounting both hooks costs one request.

import { useQuery } from "@tanstack/react-query";
import allElections from "@/data/json/elections.json";
import { useElectionContext } from "@/data/ElectionContext";
import type { ProcurementByNsFile } from "@/data/dataTypes";

const dash = (d: string): string => d.replace(/_/g, "-");
const elections = allElections as Array<{ name: string }>;

// `enabled` lets a consumer that already has the per-NS data in hand (e.g. the
// overview, which loads it itself) skip this fetch entirely.
export const useProcurementByNs = (enabled = true) => {
  const { selected } = useElectionContext();
  const idx = elections.findIndex((e) => e.name === selected);
  const from = selected ? dash(selected) : null;
  const to = idx > 0 ? dash(elections[idx - 1].name) : null;

  return useQuery({
    // Same key + shape as useProcurementOverview for this window → shared cache.
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
    enabled: enabled && !!selected,
    staleTime: Infinity,
    retry: false,
  });
};
