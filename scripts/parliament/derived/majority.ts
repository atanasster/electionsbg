// Per-item party majority. The single most-frequent non-absent vote inside a
// party group on one item — used by loyalty, dissents, and (on the frontend)
// the SessionScreen's dissent-highlight feature.
//
// Plurality, not majority-of-cast: when a party splits 5 yes / 5 no, the
// function returns the lexicographically-first peak ("yes" wins ties). Same
// behavior as the original inline implementation in SessionScreen.tsx so the
// UI's existing dissent highlights stay consistent with the pipeline.

export type VoteValue = "yes" | "no" | "abstain" | "absent";

interface VoteRecord {
  mpId: number;
  vote: VoteValue;
}

interface SessionItemLike {
  votes: VoteRecord[];
}

export const majorityFor = (
  item: SessionItemLike,
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
