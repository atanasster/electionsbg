// Single-contract fetcher. Only the bounded subset (top-N by amount +
// MP-tied) has a by-id file on disk; unknown keys → null → NotFound.

import { useQuery } from "@tanstack/react-query";
import type { ProcurementContract } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const fetchContract = async (
  key: string,
): Promise<ProcurementContract | null> => {
  const r = await fetch(dataUrl(`/procurement/contracts/by-id/${key}.json`));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as ProcurementContract;
};

export const useContract = (key?: string | null) =>
  useQuery({
    queryKey: ["procurement", "contract", key] as const,
    queryFn: () => fetchContract(key as string),
    enabled: !!key && /^[0-9a-f]{12}$/.test(key),
    staleTime: Infinity,
  });
