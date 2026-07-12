// Full procurement rankings for the standalone "see all" screens
// (/procurement/contractors, /awarders, /mps) — DB-backed
// (/api/db/procurement-rankings → procurement_rankings()). The big-list
// sibling of useProcurementOverview: complete top lists (contractors and
// awarders capped at 1000, MPs/officials unlimited), window-scoped to the
// current procurement scope (?pscope) like every other procurement page.

import { useQuery } from "@tanstack/react-query";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
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

/** Shared fetcher + key shape — useTopContractors (useProcurementIndex.tsx)
 *  reuses both with a (null, null) window so the two hooks share one cache
 *  entry when scoped identically. Resolves to null on a non-OK response, like
 *  every sibling consolidated-payload hook. */
export const fetchProcurementRankings = async (
  from: string | null,
  to: string | null,
): Promise<ProcurementRankings | null> => {
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const r = await fetch(`/api/db/procurement-rankings?${qs.toString()}`);
  if (!r.ok) return null;
  return (await r.json()) as ProcurementRankings;
};

export const rankingsQueryKey = (from: string | null, to: string | null) =>
  ["db", "procurement-rankings", from, to] as const;

export const useProcurementRankings = () => {
  const { from, to, all } = useScopeWindow();

  const query = useQuery({
    queryKey: rankingsQueryKey(from, to),
    queryFn: () => fetchProcurementRankings(from, to),
    staleTime: Infinity,
    retry: false,
  });

  return { ...query, from, to, all };
};
