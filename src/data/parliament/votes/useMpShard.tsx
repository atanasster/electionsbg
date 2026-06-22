import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { useMpProfile } from "./useMpProfile";
import type { MpShard } from "./types";

// Bridge: the candidate page hands us a roster id (the deduped, latest-per-
// person id from /parliament/index.json). The shard is keyed by the per-NS
// CSV id (parliament.bg recycles ids across NSes). When the roster id isn't
// itself a CSV id in the current NS, resolve via the embedded mpNames map.
const resolveCsvId = (
  rosterMpId: number | null | undefined,
  name: string | null | undefined,
  mpNames: Record<string, string>,
): number | null => {
  if (rosterMpId != null && mpNames[String(rosterMpId)]) return rosterMpId;
  if (!name) return rosterMpId ?? null;
  const target = name.toLocaleLowerCase("bg");
  for (const [idStr, mpName] of Object.entries(mpNames)) {
    if (mpName.toLocaleLowerCase("bg") === target) {
      const n = Number(idStr);
      if (Number.isFinite(n)) return n;
    }
  }
  return rosterMpId ?? null;
};

const queryFn = async ({
  queryKey,
}: {
  queryKey: readonly [string, string, number];
}): Promise<MpShard | null> => {
  const [, ns, csvId] = queryKey;
  const response = await fetch(
    dataUrl(`/parliament/votes/derived/per-mp/${ns}/${csvId}.json`),
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  // Vite dev (and some hosts with SPA-style 200-fallback rewrites) return
  // index.html for missing static paths instead of a real 404. Treat any
  // non-JSON content-type as a cache-miss so the consumer falls back to
  // the aggregate path cleanly instead of throwing a JSON-parse error.
  const ct = response.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return null;
  return response.json();
};

// Loads the per-MP shard for the candidate page. Returns null when the shard
// is missing for any reason (older NS that wasn't sharded, MP without
// loyalty data, fresh ingest where the shard hasn't been written yet) — the
// downstream hooks (`useMpLoyalty`, `useMpDissents`, `useMpSimilarity`) all
// fall back to the NS aggregate in that case, so the UI never breaks.
export const useMpShard = (
  mpId?: number | null,
  name?: string | null,
  enabled = true,
): { shard: MpShard | null; isLoading: boolean } => {
  const { selected } = useElectionContext();
  const ns = electionToNsFolder(selected);
  const { mpNames, isLoading: profileLoading } = useMpProfile(enabled);

  // Wait until mpNames has actually loaded before resolving the CSV id.
  // Otherwise we fire a request with the roster id (wrong key), get a
  // miss, and have to refetch once mpNames arrives.
  const profileReady = Object.keys(mpNames).length > 0;
  const csvId = useMemo(
    () =>
      profileReady ? resolveCsvId(mpId ?? null, name ?? null, mpNames) : null,
    [mpId, name, mpNames, profileReady],
  );

  const queryEnabled = enabled && !!ns && csvId != null;
  const { data, isLoading } = useQuery({
    queryKey: ["mp_shard", ns ?? "", csvId ?? 0] as [string, string, number],
    queryFn,
    enabled: queryEnabled,
    staleTime: Infinity,
    // 404 / non-JSON fallback is normal flow; don't retry.
    retry: false,
  });

  const stillResolving = enabled && !profileReady && profileLoading;
  return {
    shard: data ?? null,
    isLoading: stillResolving || (queryEnabled && isLoading),
  };
};
