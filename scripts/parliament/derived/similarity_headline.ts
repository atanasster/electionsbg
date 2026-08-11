// Pre-baked "best cross-party MP" headline for the /parliament hub. The tile only needs
// ONE MP — the seed whose topK contains the most peers from other parliamentary groups —
// plus that MP's top-3 cross-party twins. Computing it script-side replaces a 1.45 MB
// gzipped fetch of the full similarity aggregate with a ~1 KB per-NS slice.
//
// (Until 2026-08 this file's header said its logic mirrored
// `ParliamentSimilarityMiniTile.headline` so the two rankings stayed 1:1. That component is
// gone and nothing recomputes the headline at runtime — the note is removed rather than
// left to send a future editor looking for a twin to keep in sync.)
//
// GROUPS ARE FOLDED (groups.ts), for both halves of what this file does, and neither is
// visible in today's artifact:
//
//   - „is this peer CROSS-party" is the tile's whole claim, and it is a string compare
//     between two members' affiliations. Today it is right for a reason nothing states and
//     nothing enforces: no day in the corpus spells one group two ways (checked, 0 of 613),
//     so both sides of the compare come from the same spelling. On a day that did, the tile
//     would count a colleague as a stranger and OVERSTATE the headline number.
//   - the published `partyShort`s come from the LAST sitting, so which spelling they carry
//     is decided by whichever day happened to be last. All nine NSes currently land on the
//     dominant one; the 51st's variant days run to 2024-12-20, so a parliament dissolving
//     there would have published „ГЕРБ-СДС" — a label no other artifact and no party-colour
//     row carries. This is loyalty.ts's 107-MP defect with the dice rolled the other way.
//
// So it takes the NS's whole session list, not just its latest day: the affiliation is
// still read from the last sitting (that is the point — it is who they sit with NOW), but
// the SPELLING is the corpus-wide one every other artifact publishes.

import { groupLabeller, groupOf } from "./groups";
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
  sessions: SessionFile[],
): SimilarityHeadlineSlice | null => {
  if (sessions.length === 0) return null;
  // Affiliation is as of the LAST sitting — who a member sits with now, not who they once
  // did. The label for it is the corpus-wide published spelling.
  const latestSession = sessions.reduce((a, b) => (b.date > a.date ? b : a));
  const labelOf = groupLabeller(sessions);
  const partyOf = (id: number): string | undefined =>
    groupOf(latestSession, id);

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
        partyShort: labelOf(peerParty),
        score: p.score,
      });
    }
    if (cross.length === 0) continue;
    if (!best || cross.length > best.crossPartyCount) {
      cross.sort((a, b) => b.score - a.score);
      best = {
        seedId: e.mpId,
        seedPartyShort: labelOf(seedParty),
        crossPartyCount: cross.length,
        twins: cross.slice(0, TWINS),
      };
    }
  }
  return best;
};
