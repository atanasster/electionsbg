import { useCallback } from "react";
import { useMps } from "@/data/parliament/useMps";

// Builds a /candidate/... URL from a CSV-side MP id (the per-NS id
// parliament.bg writes into the roll-call CSV) and an optional fallback name
// taken from the session file's `mpNames` map. The candidate dashboard
// renders the per-MP voting record inline via MpVotingTile — there's no
// dedicated `/votes` sub-page anymore.
//
// Parliament.bg recycles MP ids across parliaments — the same person has a
// different numeric id each time they're seated. The deduped roster
// (data/parliament/index.json) keeps just the latest id per person, so a CSV
// id from an older NS (or a sometimes-missing dedup) won't resolve through
// `useResolvedCandidate`. The bridge here:
//
//   1. If the CSV id is already in the roster, use it.
//   2. Otherwise, look up the session name in the roster and use its id —
//      this is the deduped id `useResolvedCandidate` actually understands.
//   3. As a last resort, encode the bare name; the candidate route accepts a
//      name slug and tries `findMpByName` server-side / client-side.
export const useCandidateUrlForVote = () => {
  const { findMpById, findMpByName } = useMps();

  return useCallback(
    (csvMpId: number, sessionName?: string | null): string => {
      if (findMpById(csvMpId)) {
        return `/candidate/mp-${csvMpId}`;
      }
      if (sessionName) {
        const rosterMp = findMpByName(sessionName);
        if (rosterMp) return `/candidate/mp-${rosterMp.id}`;
        return `/candidate/${encodeURIComponent(sessionName)}`;
      }
      return `/candidate/mp-${csvMpId}`;
    },
    [findMpById, findMpByName],
  );
};
