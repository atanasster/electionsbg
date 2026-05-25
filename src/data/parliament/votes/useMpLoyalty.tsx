import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { useMpProfile } from "./useMpProfile";
import { useMpShard } from "./useMpShard";
import type { LoyaltyEntry, LoyaltyFile, LoyaltySlice } from "./types";

const queryFn = async (): Promise<LoyaltyFile | undefined> => {
  const response = await fetch(
    dataUrl(`/parliament/votes/derived/loyalty.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

// Strict: return data only for the requested NS. Older elections (pre-roll-
// call cycles) have no slice — falling back to a different NS would paint the
// wrong people (parliament.bg recycles ids across NSes) and the wrong party
// affiliations.
const pickSlice = (
  file: LoyaltyFile | undefined,
  ns: string | null,
): LoyaltySlice | undefined => {
  if (!ns) return undefined;
  return file?.byNs?.[ns];
};

// Loyalty file is one slice per NS (~50 KB each). We fetch once and select
// the slice matching the currently-selected election.
//
// Two-step MP lookup: pass the deduped roster id as `mpId` and the canonical
// name as `name`. The slice is keyed by parliament.bg's per-NS CSV id, which
// usually but not always matches the roster id (parliament.bg recycles ids
// across parliaments). If the roster-id lookup misses, we fall back to
// resolving the CSV id via the latest session's `mpNames` map keyed on the
// supplied name. Without this two-step path, the candidate-votes page would
// silently render "no roll-call record" for any MP whose roster id is from a
// different NS than the one selected.
export const useMpLoyalty = (mpId?: number | null, name?: string | null) => {
  const { selected } = useElectionContext();

  // Phase B fast-path: try the per-MP shard first. When present we avoid the
  // ~150 KB loyalty aggregate fetch entirely on the candidate page.
  const { shard, isLoading: shardLoading } = useMpShard(
    mpId ?? undefined,
    name ?? undefined,
  );

  // Aggregate is still fetched when the shard misses (older NSes, fresh
  // ingests, or chamber-browsing screens that call this hook without an
  // mp). React Query dedupes the request across hooks. We hold off on the
  // aggregate until the shard request resolves — otherwise both fire in
  // parallel and we waste the 1.5 MB download.
  const aggregateEnabled = !mpId && !name ? true : !shard && !shardLoading;
  const { data, isLoading: aggregateLoading } = useQuery({
    queryKey: ["rollcall_loyalty"] as [string],
    queryFn,
    staleTime: Infinity,
    enabled: aggregateEnabled,
  });

  const ns = electionToNsFolder(selected);
  const slice = pickSlice(data, ns);

  const { mpNames } = useMpProfile();

  const byMpId = useMemo(() => {
    const m = new Map<number, LoyaltyEntry>();
    for (const e of slice?.entries ?? []) m.set(e.mpId, e);
    return m;
  }, [slice]);

  // CSV id resolved from the per-NS mpNames map (embedded in the rollcall
  // index) keyed on the given name. Only used as a fallback when the supplied
  // mpId doesn't appear in the loyalty slice.
  const fallbackCsvId = useMemo(() => {
    if (!name) return null;
    const target = name.toLocaleLowerCase("bg");
    for (const [idStr, mpName] of Object.entries(mpNames)) {
      if (mpName.toLocaleLowerCase("bg") === target) {
        const n = Number(idStr);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  }, [name, mpNames]);

  // Synthesize a LoyaltyEntry from the shard so the consumer sees the same
  // shape regardless of which source served the data.
  const shardEntry: LoyaltyEntry | undefined = shard
    ? {
        mpId: shard.mpId,
        partyShort: shard.partyShort,
        votesCast: shard.loyalty.votesCast,
        withParty: shard.loyalty.withParty,
        loyaltyPct: shard.loyalty.loyaltyPct,
      }
    : undefined;

  const aggregateEntry =
    (mpId != null ? byMpId.get(mpId) : undefined) ??
    (fallbackCsvId != null ? byMpId.get(fallbackCsvId) : undefined);

  const entry = shardEntry ?? aggregateEntry;

  // Synthetic slice metadata when only the shard loaded — keeps consumers
  // that read `file.windowFrom`/`windowTo`/`totalVoteItems` happy.
  const effectiveSlice: LoyaltySlice | undefined =
    slice ??
    (shard
      ? {
          windowFrom: shard.loyalty.windowFrom,
          windowTo: shard.loyalty.windowTo,
          totalVoteItems: shard.loyalty.totalVoteItems,
          entries: [],
        }
      : undefined);

  return {
    file: effectiveSlice,
    slice: effectiveSlice,
    ns,
    entries: slice?.entries ?? [],
    entry,
    byMpId,
    isLoading: aggregateEnabled ? aggregateLoading : false,
  };
};

// Returns the top-N most-loyal and most-independent MPs in the current NS,
// filtered by a minimum votesCast threshold. The default 30 mirrors the
// embedding/cohesion runners — fewer cast votes makes the loyalty ratio
// noisy (an MP seated for a single sitting day with one defection would
// otherwise show up as the chamber's most independent).
export const useLoyaltyRanking = (topN = 5, bottomN = 5, minVotesCast = 30) => {
  const { entries, isLoading } = useMpLoyalty();
  const { top, bottom } = useMemo(() => {
    const eligible = entries.filter((e) => e.votesCast >= minVotesCast);
    const sorted = [...eligible].sort((a, b) => b.loyaltyPct - a.loyaltyPct);
    return {
      top: sorted.slice(0, topN),
      bottom: sorted.slice(-bottomN).reverse(),
    };
  }, [entries, topN, bottomN, minVotesCast]);
  return { top, bottom, isLoading };
};
