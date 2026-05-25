import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { useMpProfile } from "./useMpProfile";
import { useMpShard } from "./useMpShard";
import type { SimilarityEntry, SimilarityFile, SimilaritySlice } from "./types";

const queryFn = async (): Promise<SimilarityFile | undefined> => {
  const response = await fetch(
    dataUrl(`/parliament/votes/derived/similarity.json`),
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
  file: SimilarityFile | undefined,
  ns: string | null,
): SimilaritySlice | undefined => {
  if (!ns) return undefined;
  return file?.byNs?.[ns];
};

// Same two-step MP lookup as useMpLoyalty: pass the deduped roster id as
// `mpId` and the canonical name as `name`. If the roster-id lookup misses
// the slice (parliament.bg id recycling), the hook falls back to resolving
// the CSV id via the latest session's `mpNames` map keyed on the name.
export const useMpSimilarity = (mpId?: number | null, name?: string | null) => {
  const { selected } = useElectionContext();

  // Fast-path: shard hit avoids the ~1.5 MB similarity aggregate fetch.
  const { shard, isLoading: shardLoading } = useMpShard(
    mpId ?? undefined,
    name ?? undefined,
  );

  const aggregateEnabled = !mpId && !name ? true : !shard && !shardLoading;
  const { data, isLoading: aggregateLoading } = useQuery({
    queryKey: ["rollcall_similarity"] as [string],
    queryFn,
    staleTime: Infinity,
    enabled: aggregateEnabled,
  });

  const ns = electionToNsFolder(selected);
  const slice = pickSlice(data, ns);

  const { mpNames } = useMpProfile();

  const byMpId = useMemo(() => {
    const m = new Map<number, SimilarityEntry>();
    for (const e of slice?.entries ?? []) m.set(e.mpId, e);
    return m;
  }, [slice]);

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

  const shardEntry: SimilarityEntry | undefined = shard
    ? {
        mpId: shard.mpId,
        topK: shard.similarity.topK,
        bottomK: shard.similarity.bottomK,
      }
    : undefined;

  const aggregateEntry =
    (mpId != null ? byMpId.get(mpId) : undefined) ??
    (fallbackCsvId != null ? byMpId.get(fallbackCsvId) : undefined);

  const entry = shardEntry ?? aggregateEntry;

  return {
    file: slice,
    slice,
    ns,
    entries: slice?.entries ?? [],
    entry,
    byMpId,
    topK: slice?.topK ?? 0,
    isLoading: aggregateEnabled ? aggregateLoading : false,
  };
};
