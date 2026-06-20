// Per-EIK officials-connection lookup — the non-MP sibling of
// useProcurementMpConnectedByEik. Two-phase loader: a small manifest
// (pep-by-eik/index.json) lists every contractor EIK that a non-MP official is
// tied to; the per-EIK shard carries the rows. For the vast majority of EIKs
// (no official linkage) the manifest answers "no" and no shard fetch fires.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { ProcurementPepConnectedEntry } from "@/data/dataTypes";

interface ByEikManifest {
  eiks: string[];
}
interface ByEikShard {
  eik: string;
  entries: ProcurementPepConnectedEntry[];
}

const fetchManifest = async (): Promise<ByEikManifest | null> => {
  const r = await fetch(dataUrl("/procurement/derived/pep-by-eik/index.json"));
  if (!r.ok) return null;
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return null;
  return (await r.json()) as ByEikManifest;
};

const fetchShard = async (eik: string): Promise<ByEikShard | null> => {
  const r = await fetch(dataUrl(`/procurement/derived/pep-by-eik/${eik}.json`));
  if (!r.ok) return null;
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return null;
  return (await r.json()) as ByEikShard;
};

/** The full set of contractor EIKs tied to a non-MP official, loaded from the
 *  slim manifest. Used by the risk scorer to flag pepConnected in O(1). */
export const usePepConnectedEikSet = (): {
  set: Set<string>;
  isLoading: boolean;
  isLoaded: boolean;
} => {
  const { data, isLoading } = useQuery({
    queryKey: ["procurement", "pep_connected_by_eik_manifest"] as const,
    queryFn: fetchManifest,
    staleTime: Infinity,
    retry: false,
  });
  const set = useMemo(() => new Set(data?.eiks ?? []), [data]);
  // isLoaded gates on the manifest actually loading (data != null), NOT merely
  // isFetched — a 404/missing manifest must leave pepConnected UNAVAILABLE in
  // the risk scorer, not "available + never fires" (which would dilute every CRI).
  return { set, isLoading, isLoaded: data != null };
};

export const usePepConnectedByEik = (
  eik?: string | null,
): { entries: ProcurementPepConnectedEntry[]; isLoading: boolean } => {
  const manifestQuery = useQuery({
    queryKey: ["procurement", "pep_connected_by_eik_manifest"] as const,
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
    queryKey: ["procurement", "pep_connected_by_eik_shard", eik ?? ""] as const,
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
