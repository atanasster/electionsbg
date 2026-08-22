// The pair decoder behind /api/db/session-casts.
//
// This is the one piece of json-retirement-v2 Tier 1 where a bug produces a WRONG VOTE
// against a NAMED MP rather than a missing or slow page — the payload is a single string per
// item ("1005y,1007n,…") and an off-by-one in the walk shifts every pair after it onto the
// next MP's id. Nothing downstream can detect that: the tallies come from vote_item, so they
// still reconcile, and the heatmap simply renders the wrong colour in the wrong row.

import { describe, expect, test } from "vitest";
import { parseVotes } from "./useRollcallSession";

describe("parseVotes", () => {
  test("decodes the four vote characters", () => {
    expect(parseVotes("1y,2n,3a,4x")).toEqual([
      { mpId: 1, vote: "yes" },
      { mpId: 2, vote: "no" },
      { mpId: 3, vote: "abstain" },
      { mpId: 4, vote: "absent" },
    ]);
  });

  test("handles multi-digit ids and a single pair", () => {
    expect(parseVotes("100523y")).toEqual([{ mpId: 100523, vote: "yes" }]);
    expect(parseVotes("1005y,20063n")).toEqual([
      { mpId: 1005, vote: "yes" },
      { mpId: 20063, vote: "no" },
    ]);
  });

  test("an empty payload is an empty list, not a throw", () => {
    expect(parseVotes("")).toEqual([]);
  });

  // ALIGNMENT. The walk advances by `j + 2` past the vote char and its comma, so a
  // 240-pair string must decode to exactly 240 pairs with the LAST one intact — an
  // off-by-one shows up at the end, not at the start, which is why a two-pair fixture
  // cannot catch it.
  test("stays aligned across a full-sitting-sized payload", () => {
    const ids = Array.from({ length: 240 }, (_, i) => 1000 + i * 7);
    const chars = ["y", "n", "a", "x"] as const;
    const words = { y: "yes", n: "no", a: "abstain", x: "absent" } as const;
    const s = ids.map((id, i) => `${id}${chars[i % 4]}`).join(",");
    const got = parseVotes(s);
    expect(got).toHaveLength(240);
    expect(got[0]).toEqual({ mpId: ids[0], vote: "yes" });
    expect(got[239]).toEqual({
      mpId: ids[239],
      vote: words[chars[239 % 4]],
    });
    // Every id decoded to the id it was encoded from — the property an off-by-one breaks.
    expect(got.map((g) => g.mpId)).toEqual(ids);
  });

  // A pair that cannot be read is DROPPED, never guessed. A missing row is visible against
  // the tallies; a fabricated one is not.
  test("drops an unreadable vote character rather than inventing one", () => {
    expect(parseVotes("1y,2z,3n")).toEqual([
      { mpId: 1, vote: "yes" },
      { mpId: 3, vote: "no" },
    ]);
  });

  test("drops a pair with no id", () => {
    expect(parseVotes("y,2n")).toEqual([{ mpId: 2, vote: "no" }]);
  });
});
