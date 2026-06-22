// SPA hook for the procurement cross-reference. Fetches the full
// mp_connected.json once (small — single-digit kB at current data volume)
// and indexes by mpId so per-candidate tiles + the standalone procurement
// page can both read it without a second round-trip.
//
// If the file is absent (404) the hook treats the result as empty rather
// than throwing. The /update-procurement skill writes this file when paired
// with /update-connections; in environments without procurement data the
// SPA renders nothing rather than failing.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ProcurementMpConnectedContractor,
  ProcurementMpConnectedFile,
} from "@/data/dataTypes";
import { useMpIdForName } from "@/data/candidates/CandidateMpContext";
import { dataUrl } from "@/data/dataUrl";

const fetchMpConnected =
  async (): Promise<ProcurementMpConnectedFile | null> => {
    const response = await fetch(
      dataUrl("/procurement/derived/mp_connected.json"),
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`fetch failed: ${response.status} ${response.url}`);
    }
    return (await response.json()) as ProcurementMpConnectedFile;
  };

// Internal: one-time fetch + memoised index by mpId. Every call to the
// per-MP hook below shares the same query cache.
const useMpConnectedFile = (enabled = true) =>
  useQuery({
    queryKey: ["procurement", "mp_connected"] as const,
    queryFn: fetchMpConnected,
    staleTime: Infinity,
    enabled,
  });

export interface MpConnectedSummary {
  // Euro total across all connected contractors (EUR + BGN folded via the
  // locked peg). `totalOther` carries the rare USD/GBP/CHF remainder we keep
  // native. See src/lib/currency.ts.
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
  awardCount: number;
}

interface ProcurementShard {
  mpId: number;
  summary: MpConnectedSummary;
  entries: ProcurementMpConnectedContractor[];
}

interface ShardManifest {
  mpIds: number[];
}

// Per-MP shard manifest — tells the frontend which MPs have shards so we
// can skip both the shard-404 round-trip and the aggregate fallback for
// MPs with no declared procurement connections (the common case).
const fetchShardManifest = async (): Promise<ShardManifest | null> => {
  const r = await fetch(dataUrl("/procurement/derived/per-mp/index.json"));
  if (r.status === 404) return null;
  if (!r.ok) return null;
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return null;
  return (await r.json()) as ShardManifest;
};

const useShardManifest = () =>
  useQuery({
    queryKey: ["procurement", "shard_manifest"] as const,
    queryFn: fetchShardManifest,
    staleTime: Infinity,
    retry: false,
  });

// Per-MP shard fetch — content-type guard mirrors the votes shard hook so
// SPA-fallback HTML responses on missing paths are treated as misses
// instead of throwing a JSON-parse error.
const fetchProcurementShard = async (
  mpId: number,
): Promise<ProcurementShard | null> => {
  const r = await fetch(dataUrl(`/procurement/derived/per-mp/${mpId}.json`));
  if (r.status === 404) return null;
  if (!r.ok) return null;
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return null;
  return (await r.json()) as ProcurementShard;
};

/** Returns the MP-connected contractors for one candidate (resolved by name),
 * along with a summary rollup across them. Renders nothing-friendly: returns
 * `entries: []` when the data file is missing or the MP has no connected
 * contractors. */
export const useMpConnectedContracts = (
  name?: string | null,
): {
  entries: ProcurementMpConnectedContractor[];
  summary: MpConnectedSummary;
  isLoading: boolean;
} => {
  const mpId = useMpIdForName(name);

  // Phase 1: check the tiny manifest (~600 B) to learn whether this MP has
  // a shard at all. Avoids both the shard-404 round-trip and the aggregate
  // fallback when the MP simply has no procurement connections.
  const manifestQuery = useShardManifest();
  const mpIdsWithShards = useMemo(
    () => new Set(manifestQuery.data?.mpIds ?? []),
    [manifestQuery.data],
  );
  const hasShard = mpId != null && mpIdsWithShards.has(mpId);

  // Phase 2: per-MP shard. Only fired when the manifest says one exists.
  const shardQuery = useQuery({
    queryKey: ["procurement", "mp_connected_shard", mpId ?? 0] as const,
    queryFn: () => fetchProcurementShard(mpId!),
    enabled: hasShard,
    staleTime: Infinity,
    retry: false,
  });

  // Aggregate is the fallback only when the manifest fetch FAILS (legacy
  // deploy without shards). We wait for `isFetched` rather than just
  // checking `data != null` so we don't double-fire at initial mount
  // before the manifest response arrives.
  const manifestKnown = manifestQuery.data != null;
  const manifestSettled = manifestQuery.isFetched;
  const aggregateEnabled = mpId != null && manifestSettled && !manifestKnown;
  const q = useMpConnectedFile(aggregateEnabled);

  return useMemo(() => {
    const empty: MpConnectedSummary = {
      totalEur: 0,
      totalOther: {},
      contractCount: 0,
      awardCount: 0,
    };
    if (mpId == null) {
      return { entries: [], summary: empty, isLoading: false };
    }
    // Manifest says this MP has no shard → no connections, return empty
    // without touching the network further.
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
    const summary: MpConnectedSummary = {
      totalEur: 0,
      totalOther: {},
      contractCount: 0,
      awardCount: 0,
    };
    for (const e of entries) {
      summary.totalEur += e.totalEur;
      for (const [cur, amt] of Object.entries(e.totalOther)) {
        summary.totalOther[cur] = (summary.totalOther[cur] ?? 0) + amt;
      }
      summary.contractCount += e.contractCount;
      summary.awardCount += e.awardCount;
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
