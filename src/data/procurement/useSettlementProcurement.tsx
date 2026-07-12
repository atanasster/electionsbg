// Per-settlement procurement shards. The landing index lists every
// settlement with at least one local-tier contract; per-EKATTE files
// carry the awarder breakdown + top contracts for that settlement.
//
// Methodology lives in scripts/procurement/by_settlement.ts. Buyer HQ is
// the location proxy — central ministries and national state companies
// are excluded from per-settlement pins (they roll up into the
// "national procurement" card on the landing page).

import { useQuery } from "@tanstack/react-query";
import type {
  ProcurementBySettlementFile,
  ProcurementBySettlementIndex,
} from "@/data/dataTypes";
import { useScopeWindow } from "@/data/scope/useScopeWindow";

/** Per-settlement procurement (one EKATTE), DB-backed (/api/db/procurement-
 *  settlement → procurement_settlement_detail). Corpus-scoped: the detail
 *  drill-down has no scope toggle. Null when the settlement has no local-tier
 *  procurement on record. */
export const useSettlementProcurement = (ekatte?: string | null) =>
  useQuery({
    queryKey: ["procurement", "settlement_detail", ekatte] as const,
    queryFn: async (): Promise<ProcurementBySettlementFile | null> => {
      const r = await fetch(
        `/api/db/procurement-settlement?ekatte=${encodeURIComponent(
          ekatte as string,
        )}`,
      );
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      return (await r.json()) as ProcurementBySettlementFile | null;
    },
    enabled: !!ekatte && /^\d{5}$/.test(ekatte),
    staleTime: Infinity,
  });

/** Landing-page index — every settlement with local-tier procurement + the
 *  national rollup card, DB-backed (/api/db/procurement-by-settlement →
 *  procurement_by_settlement). Scoped to the selected parliament window or the
 *  full corpus (?pscope). */
export const useProcurementBySettlementIndex = () => {
  const { from, to } = useScopeWindow();
  return useQuery({
    queryKey: ["procurement", "by_settlement_index", from, to],
    queryFn: async (): Promise<ProcurementBySettlementIndex | null> => {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const r = await fetch(
        `/api/db/procurement-by-settlement?${qs.toString()}`,
      );
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      return (await r.json()) as ProcurementBySettlementIndex | null;
    },
    staleTime: Infinity,
  });
};
