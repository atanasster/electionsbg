// Per-município "How did they vote" data. The slim index.json only carries
// aggregate tallies; the per-councillor breakdown lives in a separate
// data/council/votes/<obshtinaCode>.json shard so we don't pull 1+ MB on
// every page load just to render the council-minutes digest.
//
// This hook lazily fetches that shard for the município passed in, then
// exposes a Map<resolutionId, perCouncillor[]> for the MyArea tile to
// join against the slim index records.
//
// Returns an empty shard when:
//   - the obshtina arg is null/undefined (no município resolved yet)
//   - the município has no named-vote data on disk (HTTP 404)
//   - the shard exists but doesn't list this resolution id (open vote)
//
// Updated 2026-05-29 when Sofia (SOF, 75 named votes) joined V. Tarnovo
// (VTR01, 38) as the second município with per-councillor data. The
// remaining shards (PVN01, SZR01, RSE01) carry aggregate-only tallies
// for now.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { councilKeyForObshtina } from "./councilObshtinaMap";

export type CouncilVoteValue = "for" | "against" | "abstain";

export type CouncilVoteRow = {
  name: string;
  /** Normalised "first last" key for roster join (lowercased, ё-folded). */
  normKey: string;
  vote: CouncilVoteValue;
};

export type CouncilVotesShard = {
  obshtinaCode: string;
  name: string;
  lastIngest: string;
  votesById: Record<string, CouncilVoteRow[]>;
};

const fetchVotes = async (
  obshtinaCode: string,
): Promise<CouncilVotesShard | null> => {
  const r = await fetch(dataUrl(`/council/votes/${obshtinaCode}.json`));
  // 404 = município has no named-vote data yet — common case for the 7
  // munis still on aggregate-only tallies. Treat as empty, not error.
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`council votes fetch failed: ${r.status}`);
  if (!(r.headers.get("content-type") ?? "").includes("json")) return null;
  return (await r.json()) as CouncilVotesShard;
};

/**
 * Takes the FRONTEND obshtina code (BGS04, S2401, SFO_CITY, …) — same
 * value MyAreaScreen passes to MyAreaCouncilMinutesTile — and resolves
 * it through councilObshtinaMap to the actual council-shard key
 * (BGS01, SOF, …) before fetching.
 */
export const useCouncilVotes = (obshtina?: string | null) => {
  const councilKey = councilKeyForObshtina(obshtina ?? null);
  const { data, isLoading } = useQuery({
    queryKey: ["council_votes", councilKey] as const,
    queryFn: () => fetchVotes(councilKey as string),
    enabled: !!councilKey,
    staleTime: Infinity,
  });
  return {
    shard: data ?? null,
    isLoading: councilKey ? isLoading : false,
    councilKey,
  };
};
