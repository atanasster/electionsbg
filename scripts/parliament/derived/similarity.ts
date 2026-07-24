// MP-to-MP similarity: cosine similarity over vote vectors. Each MP gets a
// per-item vector with values { +1 yes, -1 no, 0 abstain }; absents are
// excluded from the dot product (treated as missing data via mask, not zero).
//
// Output is a symmetric upper-triangular matrix expressed as a sparse list
// to keep the JSON small: per MP, the top-K similar peers by cosine.
//
// For v1 K=20. The full N×N matrix (~240² = 57600 entries) is small enough
// to compute in-memory but the file would be ~10 MB unzipped — top-K cuts
// that to ~50 KB.

import type { SessionFile } from "./types";

export interface SimilarityEntry {
  mpId: number;
  topK: Array<{ mpId: number; score: number; overlap: number }>;
  // Most-different peers (lowest cosine scores, ascending). Labelled "most
  // different" rather than "most opposed" on the frontend because for MPs in
  // mostly-unanimous parliaments these scores aren't always negative — they
  // just sit at the low end of that MP's distribution.
  bottomK: Array<{ mpId: number; score: number; overlap: number }>;
}

export interface SimilarityOutput {
  computedAt: string;
  topK: number;
  entries: SimilarityEntry[];
}

const TOP_K = 20;

// Overlap gate — how many shared votes a peer must have with the seed MP before
// its cosine score is trustworthy enough to rank. Applied identically to the
// "most similar" and "most different" sides so the two lists are never computed
// on different sample sizes (a peer sharing 5 votes must not out-rank one sharing
// 8 just because it slipped past a missing floor).
//
// NOISE_FLOOR mirrors SIMILARITY.minOverlap in src/data/parliament/votes/
// similarityClass.ts — below ~25 shared votes a cosine is statistical noise. It
// is kept as a literal here because scripts/ can't import from src/.
//
// In a freshly-elected parliament nobody has cast 25 votes yet, so a flat 25
// would blank the feature for the whole opening term. There we relax to "the
// peer shared at least SHARE_RATIO of THIS MP's own votes" (adaptive), never
// below HARD_MIN. Because min(25, 0.7·votes) equals 25 for any MP past ~36 cast
// votes, the gate is a plain 25 the moment the chamber matures — the ratio only
// governs the opening weeks.
const NOISE_FLOOR = 25;
const SHARE_RATIO = 0.7;
const HARD_MIN = 5;

const overlapGate = (seedVotes: number): number =>
  Math.max(HARD_MIN, Math.min(NOISE_FLOOR, Math.ceil(SHARE_RATIO * seedVotes)));

export const computeSimilarity = (
  sessions: SessionFile[],
): SimilarityOutput => {
  // Use every MP id that appears in any vote, not just those in the deduped
  // MP roster — parliament.bg's CSVs reference per-NS ids that are largely
  // disjoint from the roster's deduped ids.
  const byMp = new Map<number, Map<string, 1 | -1 | 0>>();

  for (const file of sessions) {
    for (const item of file.sessions) {
      const key = `${file.date}#${item.item}`;
      for (const v of item.votes) {
        if (v.vote === "absent") continue;
        const val: 1 | -1 | 0 = v.vote === "yes" ? 1 : v.vote === "no" ? -1 : 0;
        const m = byMp.get(v.mpId) ?? new Map<string, 1 | -1 | 0>();
        m.set(key, val);
        byMp.set(v.mpId, m);
      }
    }
  }

  const mpList = [...byMp.keys()].sort((a, b) => a - b);

  const norm = (vec: Map<string, 1 | -1 | 0>): number => {
    let sum = 0;
    for (const v of vec.values()) sum += v * v;
    return Math.sqrt(sum);
  };

  const dotOverlap = (
    a: Map<string, 1 | -1 | 0>,
    b: Map<string, 1 | -1 | 0>,
  ): { dot: number; overlap: number } => {
    let dot = 0;
    let overlap = 0;
    const small = a.size <= b.size ? a : b;
    const big = small === a ? b : a;
    for (const [k, va] of small) {
      const vb = big.get(k);
      if (vb === undefined) continue;
      overlap++;
      dot += va * vb;
    }
    return { dot, overlap };
  };

  const norms = new Map<number, number>();
  for (const id of mpList) norms.set(id, norm(byMp.get(id)!));

  const entries: SimilarityEntry[] = [];
  for (const aId of mpList) {
    const aVec = byMp.get(aId)!;
    const aNorm = norms.get(aId)!;
    if (aNorm === 0) continue;
    const scored: Array<{ mpId: number; score: number; overlap: number }> = [];
    for (const bId of mpList) {
      if (bId === aId) continue;
      const bVec = byMp.get(bId)!;
      const bNorm = norms.get(bId)!;
      if (bNorm === 0) continue;
      const { dot, overlap } = dotOverlap(aVec, bVec);
      if (overlap === 0) continue;
      scored.push({ mpId: bId, score: dot / (aNorm * bNorm), overlap });
    }
    // Gate both sides on the same minimum overlap (adaptive for young
    // parliaments — see overlapGate). This drops small-sample noise from the
    // "most similar" list, where a peer sharing a handful of votes that happen
    // to agree would otherwise post a high cosine and out-rank peers with a far
    // fuller shared record.
    const minOverlap = overlapGate(aVec.size);
    const reliable = scored.filter((s) => s.overlap >= minOverlap);
    const byScoreDesc = [...reliable].sort((x, y) => y.score - x.score);
    const topK = byScoreDesc.slice(0, TOP_K);
    // Bottom-K: same reliable pool, ascending by score, take the K worst.
    const byScoreAsc = [...reliable].sort((x, y) => x.score - y.score);
    const bottomK = byScoreAsc.slice(0, TOP_K);
    entries.push({ mpId: aId, topK, bottomK });
  }

  return {
    computedAt: new Date().toISOString(),
    topK: TOP_K,
    entries,
  };
};
