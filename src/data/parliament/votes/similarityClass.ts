// When do two MPs count as "voting twins" vs merely "similar"? One methodology, shared by every
// surface that frames roll-call similarity (per-MP tile, hub headline, full-ranking browser) so
// they can't drift.
//
// Calibrated against data/parliament/votes/derived/similarity.json (52nd NS, 268 MPs):
//   • top-peer SCORE — median 0.90, p25 0.80; 81% of MPs clear 0.75. So 0.75 marks genuinely
//     near-identical voting; ~0.55 is "votes similarly"; below that they mostly diverge.
//   • top-peer OVERLAP (shared vote items) — median ~474, but the bottom ~10% sit under 25.
//     Below ~25 shared votes a cosine score is statistical noise (a low-attendance MP), so no
//     "twin" claim is warranted no matter how high the number looks.
export const SIMILARITY = {
  /** score ≥ this AND enough overlap → a genuine "voting twin" (near-identical record). */
  twin: 0.75,
  /** score ≥ this → "votes similarly", but not a twin. */
  aligned: 0.55,
  /** fewer shared votes than this → the score is unreliable; don't classify. */
  minOverlap: 25,
} as const;

export type SimilarityTier = "twin" | "aligned" | "weak" | "unreliable";

/** Classify a peer by (cosine score, shared-vote overlap). Overlap gates first — too few shared
 *  votes and the score means nothing, regardless of how high it is. */
export const classifyPeer = (
  score: number,
  overlap: number,
): SimilarityTier => {
  if (!Number.isFinite(overlap) || overlap < SIMILARITY.minOverlap)
    return "unreliable";
  if (score >= SIMILARITY.twin) return "twin";
  if (score >= SIMILARITY.aligned) return "aligned";
  return "weak";
};

export const isVotingTwin = (score: number, overlap: number): boolean =>
  classifyPeer(score, overlap) === "twin";

/** Overlap-agnostic check for surfaces whose data doesn't carry overlap (e.g. the precomputed
 *  hub headline shard). The caller is trusting the sample size is adequate. */
export const isVotingTwinByScore = (score: number): boolean =>
  score >= SIMILARITY.twin;

/** Does this MP have at least one genuine twin? Drives the headline framing: only claim "voting
 *  twins" when a reliable, near-identical peer actually exists — otherwise it's "voting
 *  similarity" / "closest peers". */
export const hasVotingTwins = (
  peers: { score: number; overlap: number }[],
): boolean => peers.some((p) => isVotingTwin(p.score, p.overlap));
