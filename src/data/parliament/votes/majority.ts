// Frontend mirror of scripts/parliament/derived/majority.ts. The two files
// share the same algorithm but cannot share a module across the Vite/script
// boundary.

import type { SessionItem, VoteValue } from "./types";

export const majorityFor = (
  item: SessionItem,
  party: string,
  mpParty: Record<string, string>,
): VoteValue | null => {
  const counts = { yes: 0, no: 0, abstain: 0 };
  for (const v of item.votes) {
    if (v.vote === "absent") continue;
    if (mpParty[String(v.mpId)] !== party) continue;
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
