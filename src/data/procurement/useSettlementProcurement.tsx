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
import { dataUrl } from "@/data/dataUrl";

const fetchSettlement = async (
  ekatte: string,
): Promise<ProcurementBySettlementFile | null> => {
  const r = await fetch(dataUrl(`/procurement/by_settlement/${ekatte}.json`));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as ProcurementBySettlementFile;
};

const fetchIndex = async (): Promise<ProcurementBySettlementIndex | null> => {
  const r = await fetch(dataUrl(`/procurement/by_settlement/index.json`));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as ProcurementBySettlementIndex;
};

/** Per-settlement procurement file (one EKATTE). Returns null when the
 *  settlement has no local-tier procurement on record. */
export const useSettlementProcurement = (ekatte?: string | null) =>
  useQuery({
    queryKey: ["procurement", "by_settlement", ekatte] as const,
    queryFn: () => fetchSettlement(ekatte as string),
    enabled: !!ekatte && /^\d{5}$/.test(ekatte),
    staleTime: Infinity,
  });

/** Landing-page index — every settlement with local-tier procurement +
 *  the national rollup card. */
export const useProcurementBySettlementIndex = () =>
  useQuery({
    queryKey: ["procurement", "by_settlement_index"] as const,
    queryFn: fetchIndex,
    staleTime: Infinity,
  });
