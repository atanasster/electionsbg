import { useQueries } from "@tanstack/react-query";
import { useElectionContext } from "../ElectionContext";
import { dataUrl } from "@/data/dataUrl";

// Probe one election for a candidate folder. A 200 with a JSON body means the
// person was on the ballot that cycle; anything else means they weren't.
const probeElection = async (
  election: string,
  name: string,
): Promise<boolean> => {
  const res = await fetch(
    dataUrl(`/${election}/candidates/${name}/regions.json`),
  );
  // Dev's data middleware and Firebase Hosting both fall through to
  // index.html (HTTP 200) for missing files, so `res.ok` alone would count
  // every election as a hit — confirm the body is actually JSON.
  if (!res.ok) return false;
  return (res.headers.get("content-type") ?? "").includes("json");
};

/** A bare-name /candidate/:id URL carries no election, so it resolves against
 * whatever election is currently selected. When the person ran in an earlier
 * cycle they match no one in the latest election and the page renders blank
 * (the common case for search-engine results and old shared links).
 *
 * This probes every other election for a candidate folder of the same name
 * and reports the most recent one that has data; the caller switches the
 * election context so the page populates.
 *
 * `enabled` gates the whole thing — keep it false unless the candidate is
 * genuinely missing from the selected election, so candidates that already
 * resolve never fire a dozen extra requests. */
export const useCandidateElectionFallback = (
  name: string | null | undefined,
  enabled: boolean,
): { isProbing: boolean; fallbackElection: string | null } => {
  const { elections, selected } = useElectionContext();

  // elections[] is newest-first. Skip the selected election — the caller only
  // turns this on after confirming the candidate is missing from it.
  const probeTargets = elections.filter((e) => e !== selected);

  const results = useQueries({
    queries: probeTargets.map((election) => ({
      queryKey: ["candidate_election_probe", election, name] as const,
      queryFn: () => probeElection(election, name as string),
      enabled: enabled && !!name,
      staleTime: Infinity,
    })),
  });

  if (!enabled || !name) {
    return { isProbing: false, fallbackElection: null };
  }
  const isProbing = results.some((r) => r.isLoading);
  // probeTargets is newest-first, so the first hit is the most recent cycle.
  const hitIdx = results.findIndex((r) => r.data === true);
  return {
    isProbing,
    fallbackElection: hitIdx >= 0 ? probeTargets[hitIdx] : null,
  };
};
