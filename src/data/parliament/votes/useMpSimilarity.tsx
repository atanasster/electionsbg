import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { useMpProfile } from "./useMpProfile";
import { useMpShard } from "./useMpShard";
import type { SimilarityEntry, SimilarityFile, SimilaritySlice } from "./types";

/** One peer as /api/db/mp-similarity returns it (135 mp_similarity + mp_vote_norm).
 *  `score` is the SAME cosine similarity.json carries — the route divides dot by the two
 *  full-vector norms rather than returning an agreement rate, because similarityClass.ts
 *  calibrates its twin thresholds on the cosine scale. */
interface PgPeerRow {
  mp_id: number;
  overlap: number;
  score: string | number;
}

/** Both ENDS of the ranking, computed server-side. Slicing the tail off a top-N page
 *  instead would label peers ranked N-9..N of ~240 as "most different", which is a claim
 *  about two named members the data does not support. */
interface PgSimilarity {
  top: PgPeerRow[];
  bottom: PgPeerRow[];
}

// PRIMARY source: the precompute. The shard and the aggregate stay as fallbacks — but the
// ordering is what matters, because `similarity.json` is 11.7 MB and the aggregate branch
// fires whenever the per-MP shard is missing.
const pgQueryFn = async ({
  queryKey,
}: {
  queryKey: readonly [string, string, number];
}): Promise<PgSimilarity | null> => {
  const [, ns, mpId] = queryKey;
  const r = await fetch(
    `/api/db/mp-similarity?ns=${encodeURIComponent(ns)}&mp=${mpId}&limit=10`,
  );
  if (!r.ok) return null;
  const body = (await r.json()) as PgSimilarity | null;
  return body && Array.isArray(body.top) ? body : null;
};

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

  // Fast-path: shard hit avoids the ~12 MB similarity aggregate fetch.
  // csvId, not mpId — see the note in useMpDissents: the roster id is not this NS's id for
  // the 26 recycled ids, and this tier outranks the shard.
  const {
    shard,
    csvId,
    isLoading: shardLoading,
  } = useMpShard(mpId ?? undefined, name ?? undefined);

  const { mpNames } = useMpProfile();

  // Only fall back to the aggregate when the MP is actually a member of the
  // selected NS. A former MP (or any MP viewed under an election they didn't
  // serve in) has no shard AND no slice entry — loading the multi-MB aggregate
  // would just produce an empty `entry`. The two consumers (twins tile +
  // similarity browser) read only `entry`, so skipping it here is invisible.
  const browseMode = !mpId && !name;
  const profileReady = Object.keys(mpNames).length > 0;
  const mpInSelectedNs =
    profileReady &&
    ((mpId != null && mpNames[String(mpId)] != null) ||
      (!!name &&
        Object.values(mpNames).some(
          (n) => n.toLocaleLowerCase("bg") === name.toLocaleLowerCase("bg"),
        )));

  const ns = electionToNsFolder(selected);

  const { data: pgPeers, isLoading: pgLoading } = useQuery({
    queryKey: ["rollcall_similarity_pg", ns ?? "", csvId ?? 0] as [
      string,
      string,
      number,
    ],
    queryFn: pgQueryFn,
    staleTime: Infinity,
    enabled: Boolean(ns) && csvId != null && !browseMode,
  });
  const pgHit = pgPeers != null && pgPeers.top.length > 0;

  const aggregateEnabled = browseMode
    ? true
    : mpInSelectedNs && !pgHit && !pgLoading && !shard && !shardLoading;
  const { data, isLoading: aggregateLoading } = useQuery({
    queryKey: ["rollcall_similarity"] as [string],
    queryFn,
    staleTime: Infinity,
    enabled: aggregateEnabled,
  });

  const slice = pickSlice(data, ns);

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

  // The route returns peers best-first; topK/bottomK are the two ends of that ordering,
  // which is the shape both consumers read.
  const toPeer = (p: PgPeerRow) => ({
    mpId: p.mp_id,
    score: Number(p.score),
    overlap: p.overlap,
  });
  const pgEntry: SimilarityEntry | undefined = pgHit
    ? {
        mpId: csvId!,
        topK: pgPeers!.top.map(toPeer),
        // Ascending from the route: genuinely the most-different peers, matching what
        // similarity.json's bottomK means.
        bottomK: pgPeers!.bottom.map(toPeer),
      }
    : undefined;

  const entry = pgEntry ?? shardEntry ?? aggregateEntry;

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
