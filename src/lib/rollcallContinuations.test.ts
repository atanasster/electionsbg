import { it, expect } from "vitest";
import { rollcallContinuation, refreshRollcall } from "./rollcallContinuations";
import {
  validateRollcallQuery,
  encodeRollcallQuery,
  decodeRollcallQuery,
} from "./rollcallQuery";
const parsed = validateRollcallQuery({
  corpus: "parliamentCasts",
  seatIds: ["52:7"],
  from: "2026-01-01",
  toExclusive: "2027-01-01",
  topicIds: ["budget"],
  latestN: 10,
  expectedRevision: "r",
});
if (!parsed.ok) throw Error();
const q = parsed.query;
it("named month follow-up retains identity and explicit latest cohort", () =>
  expect(
    rollcallContinuation("Only April through June 2026", q)?.query,
  ).toMatchObject({
    seatIds: ["52:7"],
    from: "2026-04-01",
    toExclusive: "2026-07-01",
    latestN: 10,
    expectedRevision: "r",
  }));
it("paging pins the source revision", () =>
  expect(rollcallContinuation("Show the next 10", q)?.query).toMatchObject({
    offset: 10,
    expectedRevision: "r",
  }));
it("body switch preserves dates/topics and clears identities", () =>
  expect(
    rollcallContinuation("And in Ruse council?", q)?.previous,
  ).toMatchObject({
    corpus: "councilResolutions",
    topicIds: ["budget"],
    from: q.from,
  }));
it("second record means the displayed stable key", () => {
  const p = validateRollcallQuery({
    corpus: "parliamentVotes",
    expectedRevision: "r",
  });
  if (!p.ok) throw Error();
  const c = rollcallContinuation(
    "Show everyone who voted on the second one.",
    p.query,
    [{ key: "52:2026-01-01:9" }, { key: "51:2025-01-01:3" }],
  );
  expect(c?.query?.corpus).toBe("parliamentCasts");
  const parent = decodeRollcallQuery(c?.query?.parentQuery || "");
  expect(parent).toMatchObject({
    query: { key: "51:2025-01-01:3", expectedRevision: "r" },
  });
});
it("record ambiguity is never an ordinal guess", () =>
  expect(rollcallContinuation("Show the original document.", q)).toEqual({
    reason: "record",
  }));
it("parent membership remains complete, and explicit topic removal reaches parents", () => {
  const parent = {
    ...q,
    corpus: "parliamentVotes" as const,
    latestN: undefined,
    limit: 1,
  };
  const child = validateRollcallQuery({
    corpus: "parliamentCasts",
    parentQuery: encodeRollcallQuery(parent),
    relationship: "voteCasts",
    expectedRevision: "r",
  });
  if (!child.ok) throw Error();
  const c = rollcallContinuation("Remove the topic filter.", child.query);
  expect(decodeRollcallQuery(c?.query?.parentQuery || "")).toMatchObject({
    query: { limit: 1 },
  });
  expect(c?.query?.parentQuery).not.toContain("budget");
  expect(refreshRollcall(child.query).expectedRevision).toBeUndefined();
});
it("date and topic replacement updates nested parents without stale constraints", () => {
  const parent = {
    ...q,
    corpus: "parliamentVotes" as const,
    seatIds: undefined,
  };
  const child = validateRollcallQuery({
    corpus: "parliamentCasts",
    parentQuery: encodeRollcallQuery(parent),
    relationship: "voteCasts",
    expectedRevision: "r",
  });
  if (!child.ok) throw Error();
  const year = rollcallContinuation("And in 2025?", child.query);
  const y = decodeRollcallQuery(year?.query?.parentQuery || "");
  expect(y).toMatchObject({
    query: { from: "2025-01-01", toExclusive: "2026-01-01", latestN: 10 },
  });
  const topic = rollcallContinuation("Only healthcare.", child.query);
  expect(decodeRollcallQuery(topic?.query?.parentQuery || "")).toMatchObject({
    query: { topicIds: ["health"] },
  });
});
