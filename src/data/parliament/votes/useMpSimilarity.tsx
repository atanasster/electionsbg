import { useQuery } from "@tanstack/react-query";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { useCsvId } from "./useCsvId";
import type { SimilarityEntry } from "./types";

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

// Same two-step MP lookup as useMpLoyalty: pass the deduped roster id as
// `mpId` and the canonical name as `name`. If the roster-id lookup misses
// the slice (parliament.bg id recycling), the hook falls back to resolving
// the CSV id via the latest session's `mpNames` map keyed on the name.
export const useMpSimilarity = (mpId?: number | null, name?: string | null) => {
  const { selected } = useElectionContext();

  // Fast-path: shard hit avoids the ~12 MB similarity aggregate fetch.
  // csvId, not mpId — see the note in useMpDissents: the roster id is not this NS's id for
  // the 26 recycled ids, and this tier outranks the shard.
  const { csvId, isLoading: rosterLoading } = useCsvId(mpId, name);

  const ns = electionToNsFolder(selected);

  // No browse arm any more. It existed to serve whole-chamber callers off the aggregate;
  // all three consumers (the voting section, the twins tile and the similarity browser)
  // pass an mpId and read only `entry`, so nothing lost a caller.
  const browseMode = !mpId && !name;

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

  const entry = pgEntry;

  return {
    ns,
    entry,
    isLoading: rosterLoading || pgLoading,
  };
};
