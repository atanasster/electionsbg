// The four visual classes the six-way outcome enum collapses into.
//
// Extracted from SessionOutcomeBar so the /votes fallback path can bucket `topic_index.json`
// entries with the same rule the bar draws them by. It is the SECOND copy of this
// classification — `vote-day-summary` in functions/db_routes.js buckets in SQL, because a
// route cannot import TypeScript — and that copy is held against this one by
// `vote_day_summary.data.test.ts`, which re-derives every day's buckets from the corpus and
// fails on any disagreement. Without that gate the two would drift the first time a new
// outcome value appeared, and the symptom would be a bar of the wrong colour rather than an
// error.

import type { VoteOutcome } from "./types";

export type OutcomeBucket = "unanimous" | "passed" | "rejected" | "contested";

export const outcomeBucket = (o: VoteOutcome): OutcomeBucket => {
  switch (o) {
    case "passed_unanimous":
    case "abstain_unanimous":
    case "rejected_unanimous":
      // A chamber that abstained as one is UNANIMOUS, not rejected. Easy to get wrong, and
      // wrong in a way that only shows up as a grey segment turning red.
      return "unanimous";
    case "passed":
      return "passed";
    case "rejected":
      return "rejected";
    case "contested":
      return "contested";
  }
};
