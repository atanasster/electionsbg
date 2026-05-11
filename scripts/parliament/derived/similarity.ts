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
}

export interface SimilarityOutput {
  computedAt: string;
  topK: number;
  entries: SimilarityEntry[];
}

const TOP_K = 20;

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
    scored.sort((x, y) => y.score - x.score);
    entries.push({ mpId: aId, topK: scored.slice(0, TOP_K) });
  }

  return {
    computedAt: new Date().toISOString(),
    topK: TOP_K,
    entries,
  };
};
