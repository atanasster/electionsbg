// Per-settlement procurement detail (one EKATTE) — the awarder breakdown + top contracts
// behind /procurement/settlement/:ekatte and the My-Area / settlement tiles.
//
// The LANDING index that used to live here is gone: /procurement/by-settlement now reads a
// server-paginated ranking (the `procurement_settlements` table resource) plus a precomputed
// map payload (useProcurementGeo), so nothing fetches the whole settlement list any more.
//
// Methodology lives in procurement_by_settlement() (migration 030). Buyer HQ is the location
// proxy — central ministries and national state companies are excluded from per-settlement
// pins (they roll up into the "national procurement" card).

import { useQuery } from "@tanstack/react-query";
import type { ProcurementBySettlementFile } from "@/data/dataTypes";

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
