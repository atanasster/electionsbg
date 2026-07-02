// Per-MP procurement cross-reference — DB-backed (/api/db/ref-procurement →
// ref_procurement('/candidate/mp-<id>')). Every contractor linked to the MP
// (curated high-confidence links, full relations detail) with live totals,
// per-year breakdown and top awarders. Replaces the per-mp JSON shards +
// mp_connected.json aggregate fallback.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ProcurementMpConnectedContractor } from "@/data/dataTypes";
import { useMpIdForName } from "@/data/candidates/CandidateMpContext";

export interface MpConnectedSummary {
  // Euro total across all connected contractors (EUR + BGN folded via the
  // locked peg). `totalOther` carries the rare USD/GBP/CHF remainder we keep
  // native. See src/lib/currency.ts.
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
  awardCount: number;
}

type RefProcurementPayload = {
  ref: string;
  summary: MpConnectedSummary;
  entries: ProcurementMpConnectedContractor[];
};

const fetchRefProcurement = async (
  ref: string,
): Promise<RefProcurementPayload | null> => {
  const r = await fetch(
    `/api/db/ref-procurement?ref=${encodeURIComponent(ref)}`,
  );
  if (!r.ok) return null;
  return (await r.json()) as RefProcurementPayload;
};

export const useRefProcurement = (ref?: string | null) =>
  useQuery({
    queryKey: ["db", "ref-procurement", ref ?? ""] as const,
    queryFn: () => fetchRefProcurement(ref as string),
    enabled: !!ref,
    staleTime: Infinity,
    retry: false,
  });

/** Returns the MP-connected contractors for one candidate (resolved by name),
 * along with a summary rollup across them. Renders nothing-friendly: returns
 * `entries: []` when the MP has no connected contractors. */
export const useMpConnectedContracts = (
  name?: string | null,
): {
  entries: ProcurementMpConnectedContractor[];
  summary: MpConnectedSummary;
  isLoading: boolean;
} => {
  const mpId = useMpIdForName(name);
  const query = useRefProcurement(
    mpId != null ? `/candidate/mp-${mpId}` : null,
  );

  return useMemo(() => {
    const empty: MpConnectedSummary = {
      totalEur: 0,
      totalOther: {},
      contractCount: 0,
      awardCount: 0,
    };
    if (mpId == null || (!query.isLoading && !query.data)) {
      return { entries: [], summary: empty, isLoading: false };
    }
    if (!query.data) {
      return { entries: [], summary: empty, isLoading: query.isLoading };
    }
    const entries = query.data.entries;
    // The DB summary carries the EUR side; merge the rare native remainder
    // from the per-entry maps client-side.
    const totalOther: Record<string, number> = {};
    for (const e of entries) {
      for (const [cur, amt] of Object.entries(e.totalOther ?? {})) {
        totalOther[cur] = (totalOther[cur] ?? 0) + amt;
      }
    }
    return {
      entries,
      summary: { ...query.data.summary, totalOther },
      isLoading: false,
    };
  }, [mpId, query.data, query.isLoading]);
};
