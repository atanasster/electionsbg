// Single-contract fetcher for /procurement/contract/:key — DB-backed
// (/api/db/contract → the contracts table, ProcurementContract shape). Covers
// the whole corpus live; unknown keys → null → NotFound.

import { useQuery } from "@tanstack/react-query";
import type { ProcurementContract } from "@/data/dataTypes";

// Shared with the watchlist (useWatchlistActivity), which fetches under the
// SAME query key — keep one fetcher so the error semantics can't diverge.
export const fetchContract = async (
  key: string,
): Promise<ProcurementContract | null> => {
  const r = await fetch(`/api/db/contract?key=${encodeURIComponent(key)}`);
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
  const j = (await r.json()) as { contract: ProcurementContract | null };
  return j.contract ?? null;
};

/**
 * The two shapes a `contracts.key` takes, and the guard against firing a request for a
 * garbage route param.
 *
 * ⚠️ `obed-` IS NOT OPTIONAL POLISH. Migration 087 mints a synthetic carrier row per unnamed
 * consortium, keyed `'obed-' || left(md5(…), 12)`, and it is the row that holds the joint
 * award's whole value and its annex trail. Measured 2026-09-21: the corpus is exactly
 * 409,014 bare 12-hex keys and **2,699 `obed-` ones**, and the `/^[0-9a-f]{12}$/` form this
 * replaces matched none of the second — so `enabled` stayed false, no request was made, and
 * `/procurement/contract/obed-…` rendered „Договорът не е намерен" for every carrier
 * contract in the corpus. The API resolves them fine; only this guard rejected them.
 *
 * That was not confined to one tile: `CompanyTopContractsTile` links its rows at
 * `/procurement/contract/${key}`, so on a consortium entity's own page every top-contract
 * link was dead too.
 */
export const CONTRACT_KEY_RE = /^(?:obed-)?[0-9a-f]{12}$/;

export const useContract = (key?: string | null) =>
  useQuery({
    queryKey: ["procurement", "contract", key] as const,
    queryFn: () => fetchContract(key as string),
    enabled: !!key && CONTRACT_KEY_RE.test(key),
    staleTime: Infinity,
  });
