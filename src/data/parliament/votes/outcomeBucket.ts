// The four visual classes the six-way outcome enum collapses into.
//
// One of TWO copies of this classification. The other is `vote-day-summary` in
// functions/db_routes.js, which buckets in SQL because a route cannot import TypeScript, and
// the two are held together by `bill_and_topics.data.test.ts` — it re-derives every day's
// buckets from the corpus THROUGH THIS FUNCTION and fails on any disagreement with the route.
// Without that gate they would drift the first time a new outcome value appeared, and the
// symptom would be a bar of the wrong colour rather than an error.
//
// ⚠️ THE GATE IS THIS FUNCTION'S ONLY CALLER since json-retirement-v2 Tier 3b removed the
// /votes fallback path it was extracted for. That is deliberate, not neglect: it is the
// definition the SQL is checked against, so deleting it as "unused" would leave the route's
// bucketing held against nothing. There were briefly three copies — this one, the SQL, and a
// local re-write inside that gate — with the gate checking the SQL against its own copy and
// this one unheld by anything.

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
