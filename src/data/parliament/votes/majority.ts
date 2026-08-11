// Frontend mirror of scripts/parliament/derived/majority.ts. The two files
// share the same algorithm but cannot share a module across the Vite/script
// boundary.
//
// BOTH ARGUMENTS ARE FOLDED (groups.ts): `party` is a canonical group key and `parties` is
// the whole map already run through the same fold. That is a contract rather than a
// convenience, because the failure mode is silence — this function's only test of
// membership is a string compare, so a folded key against a raw map matches NO member, and
// a caller that folds one side and not the other gets a null majority for every group. The
// visible result is not a wrong highlight, it is no dissenters anywhere on the page.

import type { SessionItem, VoteValue } from "./types";

export const majorityFor = (
  item: SessionItem,
  party: string,
  parties: Record<string, string>,
): VoteValue | null => {
  const counts = { yes: 0, no: 0, abstain: 0 };
  for (const v of item.votes) {
    if (v.vote === "absent") continue;
    if (parties[String(v.mpId)] !== party) continue;
    counts[v.vote]++;
  }
  let best: VoteValue | null = null;
  let bestN = 0;
  for (const k of ["yes", "no", "abstain"] as const) {
    if (counts[k] > bestN) {
      best = k;
      bestN = counts[k];
    }
  }
  return best;
};
