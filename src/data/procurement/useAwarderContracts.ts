// Buyer-agnostic corpus fetch + scope-window helpers shared by every sector
// pack (roads, НОИ, and any future one). Extracted out of useRoads.tsx once a
// second pack (НОИ) started importing it — the same single-source-of-truth move
// awarderModel.ts made for the aggregation rules, applied to the data-access
// layer so the fetch key and the half-open window semantics can't drift.

import { useQuery } from "@tanstack/react-query";
import type { ProcurementContract } from "@/data/dataTypes";

/** Half-open `[from, to)` window on a contract's `date` — the scope a pack
 *  inherits from its host page. Buyer-agnostic; each pack hook re-exports it. */
export interface ScopeWindow {
  from: string | null;
  to: string | null;
}

const fetchAwarderContracts = async (
  eik: string,
): Promise<{ contracts: ProcurementContract[] } | null> => {
  const r = await fetch(
    `/api/db/awarder-contracts?eik=${encodeURIComponent(eik)}`,
  );
  if (!r.ok) return null;
  return (await r.json()) as { contracts: ProcurementContract[] };
};

/** The shared query definition, so a pack that has to fan out over several EIKs
 *  (an institution registered under more than one) reuses the exact fetch, key
 *  and caching policy rather than re-deriving them. */
export const awarderContractsQuery = (eik?: string | null) => ({
  queryKey: ["db", "awarder-contracts", eik] as const,
  queryFn: () => fetchAwarderContracts(eik as string),
  enabled: !!eik && /^\d{9,13}$/.test(eik),
  staleTime: Infinity,
  retry: false,
});

/** Full per-contract corpus for one awarder (≈2k rows for the packed buyers),
 *  cached once; packs window it client-side via scopeByWindow. */
export const useAwarderContracts = (eik?: string | null) =>
  useQuery(awarderContractsQuery(eik));

/** Apply a half-open `[from, to)` window to already-loaded rows — same semantics
 *  as procurement_overview. Single-sourced so pack scope filtering can't drift.
 *  `null`/`null` returns the whole corpus. */
export const scopeByWindow = <T extends { date?: string }>(
  rows: T[],
  from: string | null,
  to: string | null,
): T[] =>
  !from && !to
    ? rows
    : rows.filter(
        (c) =>
          (!from || (c.date ?? "") >= from) && (!to || (c.date ?? "") < to),
      );
