// SPA hook for the EU-funds MP cross-reference. Fetches the full
// mp_connected.json once (small) and shares the cache between the standalone
// /funds page and the per-candidate tile + page.
//
// If the file is absent (404) the result is empty rather than an error — the
// /update-funds skill writes it only when companies-index.json is present.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMpIdForName } from "@/data/candidates/CandidateMpContext";
import { dataUrl } from "@/data/dataUrl";
import type { FundsMpConnected, FundsMpConnectedFile } from "./types";

const fetchMpConnected = async (): Promise<FundsMpConnectedFile | null> => {
  const r = await fetch(dataUrl("/funds/derived/mp_connected.json"));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as FundsMpConnectedFile;
};

// One-time fetch — every per-MP call below shares this query cache.
export const useFundsMpConnectedFile = (enabled = true) =>
  useQuery({
    queryKey: ["funds", "mp_connected"] as const,
    queryFn: fetchMpConnected,
    staleTime: Infinity,
    enabled,
  });

export interface FundsMpConnectedSummary {
  contractCount: number;
  contractedEur: number;
  paidEur: number;
}

interface FundsShard {
  mpId: number;
  summary: FundsMpConnectedSummary;
  entries: FundsMpConnected[];
}

interface ShardManifest {
  mpIds: number[];
}

const fetchShardManifest = async (): Promise<ShardManifest | null> => {
  const r = await fetch(dataUrl("/funds/derived/per-mp/index.json"));
  if (r.status === 404) return null;
  if (!r.ok) return null;
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return null;
  return (await r.json()) as ShardManifest;
};

const useShardManifest = () =>
  useQuery({
    queryKey: ["funds", "shard_manifest"] as const,
    queryFn: fetchShardManifest,
    staleTime: Infinity,
    retry: false,
  });

const fetchFundsShard = async (mpId: number): Promise<FundsShard | null> => {
  const r = await fetch(dataUrl(`/funds/derived/per-mp/${mpId}.json`));
  if (r.status === 404) return null;
  if (!r.ok) return null;
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return null;
  return (await r.json()) as FundsShard;
};

/** EU-funds MP cross-reference for one beneficiary EIK — which MP(s) are
 * linked to this company, and through what declared/registered relation.
 * The mirror of `useMpConnectedFunds`, keyed by the company instead of the
 * MP, for the per-company page. */
export const useFundsConnectedForEik = (
  eik?: string | null,
): { entries: FundsMpConnected[]; isLoading: boolean } => {
  const q = useFundsMpConnectedFile();
  return useMemo(() => {
    if (!eik || !q.data) {
      return { entries: [], isLoading: !!eik && q.isLoading };
    }
    return {
      entries: q.data.entries.filter((e) => e.beneficiaryEik === eik),
      isLoading: false,
    };
  }, [eik, q.data, q.isLoading]);
};

/** EU-funds beneficiaries connected to one candidate (resolved by name) plus
 * a summary rollup. Returns `entries: []` when the file is missing or the MP
 * has no connected beneficiaries. */
export const useMpConnectedFunds = (
  name?: string | null,
): {
  entries: FundsMpConnected[];
  summary: FundsMpConnectedSummary;
  isLoading: boolean;
} => {
  const mpId = useMpIdForName(name);

  // Phase 1: manifest tells us whether this MP has a shard.
  const manifestQuery = useShardManifest();
  const mpIdsWithShards = useMemo(
    () => new Set(manifestQuery.data?.mpIds ?? []),
    [manifestQuery.data],
  );
  const hasShard = mpId != null && mpIdsWithShards.has(mpId);

  // Phase 2: shard only fetched when manifest confirms it exists.
  const shardQuery = useQuery({
    queryKey: ["funds", "mp_connected_shard", mpId ?? 0] as const,
    queryFn: () => fetchFundsShard(mpId!),
    enabled: hasShard,
    staleTime: Infinity,
    retry: false,
  });

  // Wait for the manifest fetch to actually complete before deciding to
  // fire the aggregate — otherwise both race at initial mount.
  const manifestKnown = manifestQuery.data != null;
  const manifestSettled = manifestQuery.isFetched;
  const aggregateEnabled = mpId != null && manifestSettled && !manifestKnown;
  const q = useFundsMpConnectedFile(aggregateEnabled);

  return useMemo(() => {
    const empty: FundsMpConnectedSummary = {
      contractCount: 0,
      contractedEur: 0,
      paidEur: 0,
    };
    if (mpId == null) {
      return { entries: [], summary: empty, isLoading: false };
    }
    if (manifestKnown && !hasShard) {
      return { entries: [], summary: empty, isLoading: false };
    }
    if (shardQuery.data) {
      return {
        entries: shardQuery.data.entries,
        summary: shardQuery.data.summary,
        isLoading: false,
      };
    }
    if (!q.data) {
      return {
        entries: [],
        summary: empty,
        isLoading:
          manifestQuery.isLoading || shardQuery.isLoading || q.isLoading,
      };
    }
    const entries = q.data.entries.filter((e) => e.mpId === mpId);
    const summary: FundsMpConnectedSummary = {
      contractCount: 0,
      contractedEur: 0,
      paidEur: 0,
    };
    for (const e of entries) {
      summary.contractCount += e.contractCount;
      summary.contractedEur += e.contractedEur;
      summary.paidEur += e.paidEur;
    }
    return { entries, summary, isLoading: false };
  }, [
    mpId,
    q.data,
    q.isLoading,
    shardQuery.data,
    shardQuery.isLoading,
    manifestKnown,
    hasShard,
    manifestQuery.isLoading,
  ]);
};
