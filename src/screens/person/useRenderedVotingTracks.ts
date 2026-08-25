// Which of a person's voting tracks will actually PUT A CARD ON THE PAGE.
//
// `votingTracks` answers "which bodies did this person sit in", which is not the same
// question: both cards self-hide when their own corpus has nothing attributed for this
// person. The gap is not a rare residue — the council corpus covers 16 of 265 municipalities,
// so measured 2026-08-25, of the 348 people holding both a councillor role and an MP role
// only 143 sit in a covered council. Gating the track headers on the roles alone therefore
// left a lone labelled pill above the only card on the page for the MAJORITY of the very
// population the headers were written for — the exact state `showTrackHeaders`'s own rule
// forbids ("a pill above the one voting card they have is chrome that labels nothing").
//
// Every hook here is already called by the card it predicts, and React Query dedupes on the
// key, so this costs no extra request. The coupling is real but NAMED and in one place: if a
// card's self-hide rule changes, this is the file that has to change with it.

import { useCouncilCouncillor } from "@/data/council/useCouncilHub";
import { useMpLoyalty } from "@/data/parliament/votes/useMpLoyalty";
import { useMpSimilarity } from "@/data/parliament/votes/useMpSimilarity";
import type { VotingTrack } from "./votingTracks";

/**
 * The subset of `tracks` whose card will render.
 *
 * ⚠️ Mirrors each card's OWN self-hide condition, and must keep mirroring it:
 *   - local    → `PersonCouncilVoting` renders iff `useCouncilCouncillor` resolved data.
 *   - national → `MpVotingSection` renders iff it is still loading, or has loyalty data, or
 *                has similarity data (`!loading && !hasVoting && !hasTwins` → null).
 *
 * WHILE LOADING both are treated as "will render", which is deliberate: a header that
 * appeared only after its card resolved would shift the page for every reader, whereas the
 * only cost of being wrong here is one pill that disappears with its card.
 */
export const useRenderedVotingTracks = (
  tracks: VotingTrack[],
  slug: string,
  name: string,
  mpId: number | null,
): VotingTrack[] => {
  const { data: council, isLoading: councilLoading } =
    useCouncilCouncillor(slug);
  const { entry: loyalty, isLoading: loyaltyLoading } = useMpLoyalty(
    mpId,
    name,
  );
  const { entry: similarity, isLoading: simLoading } = useMpSimilarity(
    mpId,
    name,
  );

  const localRenders = councilLoading || !!council;
  const nationalRenders =
    loyaltyLoading ||
    simLoading ||
    (!!loyalty && loyalty.votesCast > 0) ||
    (similarity?.topK?.length ?? 0) > 0;

  return tracks.filter((t) =>
    t.kind === "local" ? localRenders : nationalRenders,
  );
};
