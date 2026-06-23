// Single-contract fetcher for /procurement/contract/:key.
//
// Resolution order:
//   1. Single-file `by-id/<key>.json` — the bounded tree (top-N by amount +
//      MP-tied). ~600 bytes, the fast path for the most-linked contracts (the
//      journalism payload deep-linked from MP / top-contractor pages).
//   2. Fallback prefix shard `by-id/shard/<key[:3]>.json` — a { key → Contract }
//      map covering the WHOLE corpus (see scripts/procurement/by_id_shards.ts).
//      ~100 KB, hit only for long-tail rows the browser now deep-links.
// Unknown keys → null → NotFound.
//
// A "soft miss" is any response we can't parse as the expected JSON: a real 404
// (production / GCS) or — in the Vite dev server — a 200 serving the SPA
// index.html for a file that doesn't exist. Both fall through to the next tier.

import { useQuery } from "@tanstack/react-query";
import type { ProcurementContract } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const parseJson = async <T,>(r: Response): Promise<T | undefined> => {
  if (!r.ok) {
    if (r.status === 404) return undefined; // genuine miss
    throw new Error(`fetch failed: ${r.status} ${r.url}`);
  }
  try {
    return (await r.json()) as T;
  } catch {
    return undefined; // dev SPA fallback (HTML) / non-JSON ⇒ treat as a miss
  }
};

const fetchContract = async (
  key: string,
): Promise<ProcurementContract | null> => {
  // 1. Single-file fast path (hot subset).
  const single = await parseJson<ProcurementContract>(
    await fetch(dataUrl(`/procurement/contracts/by-id/${key}.json`)),
  );
  if (single) return single;

  // 2. Prefix shard (universal coverage for the long tail).
  const map = await parseJson<Record<string, ProcurementContract>>(
    await fetch(
      dataUrl(`/procurement/contracts/by-id/shard/${key.slice(0, 3)}.json`),
    ),
  );
  return map?.[key] ?? null;
};

export const useContract = (key?: string | null) =>
  useQuery({
    queryKey: ["procurement", "contract", key] as const,
    queryFn: () => fetchContract(key as string),
    enabled: !!key && /^[0-9a-f]{12}$/.test(key),
    staleTime: Infinity,
  });
