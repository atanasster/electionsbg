// The accept-side half of docs/plans/polls-ai-review-v1.md: how a reviewed
// draft proves the review still applies to it.
import { createHash } from "node:crypto";
import type { PollLock } from "../../../src/data/polls/pollsTypes";
import type { InboxDraft } from "./draft";

/** Hash of everything the reviewer saw — the draft minus its own
 *  `aiReview` — so the stamp can be checked against the file accept reads. */
export const reviewDraftHash = (draft: InboxDraft): string => {
  const reviewed: Partial<InboxDraft> = { ...draft };
  delete reviewed.aiReview;
  return createHash("sha256").update(JSON.stringify(reviewed)).digest("hex");
};

/** The `locked.review` to stamp, or `undefined` when the draft carries no
 *  agreeing review or was edited after it. Never throws: a stale review
 *  just means the poll is recorded as human-accepted, which it then is. */
export const aiReviewStamp = (
  draft: InboxDraft,
): PollLock["review"] | undefined => {
  const review = draft.aiReview;
  if (!review || review.verdict !== "agree") return undefined;
  if (review.draftHash !== reviewDraftHash(draft)) return undefined;
  return {
    kind: "ai_agreement",
    model: review.model,
    reviewedAt: review.reviewedAt,
    draftHash: review.draftHash,
  };
};
