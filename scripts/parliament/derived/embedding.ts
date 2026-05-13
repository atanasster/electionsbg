// 2D UMAP embedding of MPs over their roll-call vote vectors. Each MP is
// represented as a vector of (+1 yes, -1 no, 0 abstain, 0 absent) across
// every (date, item) tuple the session files contain. UMAP projects that
// high-dim space to 2D so the frontend can scatter-plot MPs with cluster
// structure visible at a glance.
//
// Output is small (~50 KB for the full 52nd NS) and stable across runs
// because we seed UMAP's PRNG deterministically.

import type { SessionFile } from "./types";
import { UMAP } from "umap-js";

export interface EmbeddingPoint {
  mpId: number;
  x: number;
  y: number;
}

export interface EmbeddingOutput {
  computedAt: string;
  dim: 2;
  nMps: number;
  nFeatures: number;
  points: EmbeddingPoint[];
}

const TARGET_COMPONENTS = 2;
const N_NEIGHBORS_DEFAULT = 15;
const MIN_DIST = 0.1;

// Minimum overlap between an MP's vote vector and the full feature set
// before we include them in the projection. MPs who only voted on a handful
// of items destabilize UMAP — drop them out of the projection but keep them
// in the roster.
const MIN_VOTES = 10;

const voteToScalar = (vote: string): number => {
  if (vote === "yes") return 1;
  if (vote === "no") return -1;
  // abstain and absent both map to 0 — the cosine layer treats "didn't take
  // a side" as the same kind of signal.
  return 0;
};

// Tiny deterministic PRNG. umap-js's `random` option needs a () => number in
// [0, 1). Seed comes from the feature count so a rebuild on the same data
// reproduces the same coordinates.
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const computeEmbedding = (sessions: SessionFile[]): EmbeddingOutput => {
  // 1. Canonical feature ordering — one column per (date, item).
  const features: string[] = [];
  for (const f of sessions) {
    for (const item of f.sessions) {
      features.push(`${f.date}#${item.item}`);
    }
  }
  features.sort();

  // 2. MP → column → scalar map. Sparse map, dense the matrix later.
  const byMp = new Map<number, Map<string, number>>();
  for (const f of sessions) {
    for (const item of f.sessions) {
      const key = `${f.date}#${item.item}`;
      for (const v of item.votes) {
        const m = byMp.get(v.mpId) ?? new Map<string, number>();
        m.set(key, voteToScalar(v.vote));
        byMp.set(v.mpId, m);
      }
    }
  }

  const mpIds = [...byMp.keys()]
    .filter((id) => (byMp.get(id)?.size ?? 0) >= MIN_VOTES)
    .sort((a, b) => a - b);

  if (mpIds.length < TARGET_COMPONENTS + 1 || features.length === 0) {
    return {
      computedAt: new Date().toISOString(),
      dim: 2,
      nMps: mpIds.length,
      nFeatures: features.length,
      points: [],
    };
  }

  // 3. Densify into a (mps, features) matrix.
  const matrix: number[][] = mpIds.map((id) => {
    const row = new Array(features.length).fill(0);
    const m = byMp.get(id)!;
    for (let i = 0; i < features.length; i++) {
      const v = m.get(features[i]);
      if (v !== undefined) row[i] = v;
    }
    return row;
  });

  // 4. Run UMAP. nNeighbors must be < n_samples; clamp for small parliaments.
  const umap = new UMAP({
    nComponents: TARGET_COMPONENTS,
    nNeighbors: Math.min(N_NEIGHBORS_DEFAULT, Math.max(2, mpIds.length - 1)),
    minDist: MIN_DIST,
    random: mulberry32(features.length || 1),
  });
  const embedding = umap.fit(matrix);

  const points: EmbeddingPoint[] = embedding.map((row, i) => ({
    mpId: mpIds[i],
    x: Number(row[0].toFixed(4)),
    y: Number(row[1].toFixed(4)),
  }));

  return {
    computedAt: new Date().toISOString(),
    dim: 2,
    nMps: mpIds.length,
    nFeatures: features.length,
    points,
  };
};
