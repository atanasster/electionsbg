// EU Single Market Scoreboard competition indicators, DB-backed
// (/api/db/procurement-benchmarks → procurement_benchmarks), scoped to the
// selected parliament window / year or the full corpus (?pscope).

import { useQuery } from "@tanstack/react-query";
import { useProcurementWindow } from "./useProcurementWindow";

export type ProcurementBenchmarksFile = {
  total: number;
  singleBidder: { single: number; known: number };
  noCall: { noCall: number; methodKnown: number };
};

export const useProcurementBenchmarks = (enabled = true) => {
  const { from, to } = useProcurementWindow();
  return useQuery({
    enabled,
    queryKey: ["procurement", "benchmarks", from, to],
    queryFn: async (): Promise<ProcurementBenchmarksFile | null> => {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const r = await fetch(`/api/db/procurement-benchmarks?${qs.toString()}`);
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      return (await r.json()) as ProcurementBenchmarksFile;
    },
    staleTime: Infinity,
  });
};
