// Per-EIK MP-connection lookup. Replaces the chamber-wide fetch +
// client-side filter the /company/{eik} and /awarder/{eik} pages used to
// do, which streamed the full ~105 KB procurement/derived/mp_connected.json
// even though they only needed the rows for one EIK.
//
// Two-phase loader:
//   1. Manifest (procurement/derived/by-eik/index.json) lists every EIK
//      that has at least one MP linkage. ~few KB.
//   2. Per-EIK shard (procurement/derived/by-eik/{eik}.json) carries the
//      MP entries for that EIK. ~1-3 KB each.
//
// For an EIK with no MP linkage (the vast majority), the manifest answers
// "no" and the page renders the empty state without any shard fetch.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { ProcurementMpConnectedFile } from "@/data/dataTypes";

type Entry = ProcurementMpConnectedFile["entries"][number];

interface ByEikManifest {
  eiks: string[];
}

interface ByEikShard {
  eik: string;
  entries: Entry[];
}

const fetchManifest = async (): Promise<ByEikManifest | null> => {
  const r = await fetch(dataUrl("/procurement/derived/by-eik/index.json"));
  if (r.status === 404) return null;
  if (!r.ok) return null;
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return null;
  return (await r.json()) as ByEikManifest;
};

const fetchShard = async (eik: string): Promise<ByEikShard | null> => {
  const r = await fetch(dataUrl(`/procurement/derived/by-eik/${eik}.json`));
  if (r.status === 404) return null;
  if (!r.ok) return null;
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return null;
  return (await r.json()) as ByEikShard;
};

export const useProcurementMpConnectedByEik = (
  eik?: string | null,
): { entries: Entry[]; isLoading: boolean } => {
  const manifestQuery = useQuery({
    queryKey: ["procurement", "mp_connected_by_eik_manifest"] as const,
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
    queryKey: ["procurement", "mp_connected_by_eik_shard", eik ?? ""] as const,
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
