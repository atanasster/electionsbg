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
import { useProcurementScope } from "./useProcurementScope";
import { useElectionContext } from "@/data/ElectionContext";

const fetchSettlement = async (
  ekatte: string,
): Promise<ProcurementBySettlementFile | null> => {
  const r = await fetch(dataUrl(`/procurement/by_settlement/${ekatte}.json`));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as ProcurementBySettlementFile;
};

const fetchIndex = async (
  url: string,
): Promise<ProcurementBySettlementIndex | null> => {
  const r = await fetch(url);
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
 *  the national rollup card. Scope-aware: ns → the per-election index
 *  (by_ns/by_settlement/<date>.json); all → the full-corpus index. (The
 *  per-EKATTE detail drill-down has no scope toggle, so it stays corpus.) */
export const useProcurementBySettlementIndex = () => {
  const { scope } = useProcurementScope();
  const { selected } = useElectionContext();
  const ns = scope === "ns";
  const url = ns
    ? dataUrl(`/procurement/by_ns/by_settlement/${selected}.json`)
    : dataUrl(`/procurement/by_settlement/index.json`);
  return useQuery({
    queryKey: [
      "procurement",
      "by_settlement_index",
      ns ? `ns:${selected}` : "all",
    ],
    queryFn: () => fetchIndex(url),
    staleTime: Infinity,
  });
};
