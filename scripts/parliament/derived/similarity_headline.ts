// Pre-baked "best cross-party MP" headline for ParliamentSimilarityMiniTile.
// The hub tile only needs ONE MP — the seed whose topK contains the most
// peers from other parliamentary groups — plus that MP's top-3 cross-party
// twins. Computing it script-side replaces a 1.45 MB gzipped fetch of the
// full similarity aggregate with a ~1 KB per-NS slice.
//
// Logic mirrors ParliamentSimilarityMiniTile.headline at src/screens/
// dashboard/ParliamentSimilarityMiniTile.tsx so the runtime and script-side
// rankings stay 1:1.

import type { SessionFile } from "./types";
import type { SimilarityOutput } from "./similarity";

const TWINS = 3;

export interface HeadlineTwin {
  mpId: number;
  partyShort: string;
  score: number;
}

export interface SimilarityHeadlineSlice {
  seedId: number;
  seedPartyShort: string;
  /** Number of cross-party peers in the seed's topK (the criterion that
   *  earned this MP the headline). */
  crossPartyCount: number;
  twins: HeadlineTwin[];
}

export interface SimilarityHeadlineOutput {
  computedAt: string;
  byNs: Record<string, SimilarityHeadlineSlice>;
}

export const computeSimilarityHeadline = (
  similarity: SimilarityOutput,
  latestSession: SessionFile,
): SimilarityHeadlineSlice | null => {
  // Party affiliation comes from the latest session's mpParty map — same
  // source the runtime tile reads (via useMpProfile, which surfaces
  // mpProfileByNs[ns] from the index file). Keyed by stringified CSV id.
  const mpParty = latestSession.mpParty ?? {};
  const partyOf = (id: number): string | undefined => mpParty[String(id)];

  let best: SimilarityHeadlineSlice | null = null;
  for (const e of similarity.entries) {
    const seedParty = partyOf(e.mpId);
    if (!seedParty) continue;
    const cross: HeadlineTwin[] = [];
    for (const p of e.topK) {
      const peerParty = partyOf(p.mpId);
      if (!peerParty || peerParty === seedParty) continue;
      cross.push({
        mpId: p.mpId,
        partyShort: peerParty,
        score: p.score,
      });
    }
    if (cross.length === 0) continue;
    if (!best || cross.length > best.crossPartyCount) {
      cross.sort((a, b) => b.score - a.score);
      best = {
        seedId: e.mpId,
        seedPartyShort: seedParty,
        crossPartyCount: cross.length,
        twins: cross.slice(0, TWINS),
      };
    }
  }
  return best;
};
