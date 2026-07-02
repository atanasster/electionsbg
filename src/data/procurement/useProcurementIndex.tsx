// Full-corpus top-contractors list — DB-backed (/api/db/procurement-rankings
// with no window → procurement_rankings(NULL, NULL)). Shares the rankings
// query cache (same key + fetcher as useProcurementRankings for the all-years
// window); `select` derives the old ProcurementTopContractorsFile shape so
// consumers are unchanged.

import { useQuery } from "@tanstack/react-query";
import type { ProcurementTopContractorsFile } from "@/data/dataTypes";
import {
  fetchProcurementRankings,
  rankingsQueryKey,
} from "./useProcurementRankings";

// `enabled` lets a consumer already showing per-NS data (the overview) skip the
// full-corpus fetch.
export const useTopContractors = (enabled = true) =>
  useQuery({
    queryKey: rankingsQueryKey(null, null),
    queryFn: () => fetchProcurementRankings(null, null),
    select: (data): ProcurementTopContractorsFile | null =>
      data
        ? {
            generatedAt: "",
            total: data.topContractors.length,
            entries: data.topContractors,
          }
        : null,
    enabled,
    staleTime: Infinity,
    retry: false,
  });
