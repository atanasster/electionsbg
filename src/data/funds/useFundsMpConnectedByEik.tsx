// Per-EIK funds MP-connection lookup. Replaces the chamber-wide fetch +
// client-side filter the /company/{eik} page used to do (streaming the
// full ~93 KB funds/derived/mp_connected.json just to filter for one EIK).
//
// Same manifest-then-shard pattern as useProcurementMpConnectedByEik.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { FundsMpConnected } from "./types";

interface ByEikManifest {
  eiks: string[];
}

interface ByEikShard {
  eik: string;
  entries: FundsMpConnected[];
}

const fetchManifest = async (): Promise<ByEikManifest | null> => {
  const r = await fetch(dataUrl("/funds/derived/by-eik/index.json"));
  if (r.status === 404) return null;
  if (!r.ok) return null;
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return null;
  return (await r.json()) as ByEikManifest;
};

const fetchShard = async (eik: string): Promise<ByEikShard | null> => {
  const r = await fetch(dataUrl(`/funds/derived/by-eik/${eik}.json`));
  if (r.status === 404) return null;
  if (!r.ok) return null;
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return null;
  return (await r.json()) as ByEikShard;
};

/** EU-funds MP cross-reference for one beneficiary EIK — replaces the
 * older `useFundsConnectedForEik` (which read the chamber-wide aggregate).
 * Returns `{ entries: [], isLoading: false }` when the EIK has no MP
 * connection on record. */
export const useFundsMpConnectedByEik = (
  eik?: string | null,
): { entries: FundsMpConnected[]; isLoading: boolean } => {
  const manifestQuery = useQuery({
    queryKey: ["funds", "mp_connected_by_eik_manifest"] as const,
    queryFn: fetchManifest,
    staleTime: Infinity,
    enabled: !!eik,
    retry: false,
  });
  const flagged = useMemo(
    () => new Set(manifestQuery.data?.eiks ?? []),
    [manifestQuery.data],
  );
  const isFlagged = !!eik && flagged.has(eik);

  const shardQuery = useQuery({
    queryKey: ["funds", "mp_connected_by_eik_shard", eik ?? ""] as const,
    queryFn: () => fetchShard(eik!),
    enabled: isFlagged,
    staleTime: Infinity,
    retry: false,
  });

  return useMemo(() => {
    if (!eik) return { entries: [], isLoading: false };
    const manifestKnown = manifestQuery.data != null || manifestQuery.isFetched;
    if (!manifestKnown) return { entries: [], isLoading: true };
    if (!isFlagged) return { entries: [], isLoading: false };
    if (shardQuery.data)
      return { entries: shardQuery.data.entries, isLoading: false };
    return { entries: [], isLoading: shardQuery.isLoading };
  }, [
    eik,
    isFlagged,
    manifestQuery.data,
    manifestQuery.isFetched,
    shardQuery.data,
    shardQuery.isLoading,
  ]);
};
