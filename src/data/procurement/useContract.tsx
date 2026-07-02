// Single-contract fetcher for /procurement/contract/:key — DB-backed
// (/api/db/contract → the contracts table, ProcurementContract shape). Covers
// the whole corpus live; unknown keys → null → NotFound.

import { useQuery } from "@tanstack/react-query";
import type { ProcurementContract } from "@/data/dataTypes";

const fetchContract = async (
  key: string,
): Promise<ProcurementContract | null> => {
  const r = await fetch(`/api/db/contract?key=${encodeURIComponent(key)}`);
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
  const j = (await r.json()) as { contract: ProcurementContract | null };
  return j.contract ?? null;
};

export const useContract = (key?: string | null) =>
  useQuery({
    queryKey: ["procurement", "contract", key] as const,
    queryFn: () => fetchContract(key as string),
    enabled: !!key && /^[0-9a-f]{12}$/.test(key),
    staleTime: Infinity,
  });
