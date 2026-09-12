import { describe, it, expect } from "vitest";
import {
  validateRollcallQuery,
  encodeRollcallQuery,
  decodeRollcallQuery,
  rollcallScope,
} from "./rollcallQuery";
describe("roll-call canonical scope", () => {
  it.each([
    "parliamentSessions",
    "parliamentVotes",
    "parliamentCasts",
    "councilSessions",
    "councilResolutions",
    "councilCasts",
  ])("round trips %s", (corpus) => {
    const a = validateRollcallQuery({ corpus });
    expect(a.ok).toBe(true);
    expect(decodeRollcallQuery(encodeRollcallQuery({ corpus }))).toEqual(a);
  });
  it.each([
    { corpus: "parliamentVotes", councilIds: ["SOF"] },
    { corpus: "councilCasts", seatIds: ["52:5254"] },
    { corpus: "parliamentSessions", choice: "against" },
    {
      corpus: "parliamentVotes",
      from: "2026-02-30",
      toExclusive: "2026-03-01",
    },
    { corpus: "parliamentVotes", from: "2026-02-01" },
    {
      corpus: "parliamentVotes",
      from: "2026-03-01",
      toExclusive: "2026-02-01",
    },
    { corpus: "parliamentCasts", seatIds: ["5254"] },
    { corpus: "councilCasts", councilCastKeys: ["Иван Иванов"] },
    { corpus: "parliamentVotes", offset: 10 },
    { corpus: "parliamentVotes", limit: 101 },
    { corpus: "parliamentVotes", sql: "SELECT 1" },
    { corpus: "parliamentVotes", version: "future" },
    {
      corpus: "parliamentVotes",
      operation: "compare",
      from: "2025-01-01",
      toExclusive: "2026-01-01",
    },
    { corpus: "parliamentVotes", operation: "share" },
    { corpus: "parliamentVotes", topicIds: ["made-up"] },
  ])("rejects illegal scope %j", (q) =>
    expect(validateRollcallQuery(q).ok).toBe(false),
  );
  it("keeps latest N separate from page size and bases", () => {
    const p = validateRollcallQuery({
      corpus: "parliamentCasts",
      latestN: 10,
      limit: 3,
    });
    expect(p.ok && p.query).toMatchObject({
      latestN: 10,
      limit: 3,
      basis: "attempts",
    });
    const c = validateRollcallQuery({
      corpus: "parliamentVotes",
      operation: "count",
    });
    expect(c.ok && c.query.basis).toBe("standing");
  });
  it("allows leap dates and canonicalizes filter order", () => {
    const q = {
      corpus: "parliamentVotes",
      from: "2024-02-29",
      toExclusive: "2024-03-01",
      assemblyIds: ["52", "51", "52"],
    };
    expect(encodeRollcallQuery(q)).toBe(
      encodeRollcallQuery({ ...q, assemblyIds: ["51", "52"] }),
    );
  });
  it("validates parent grain and recursion", () => {
    const parentQuery = encodeRollcallQuery({ corpus: "parliamentSessions" });
    expect(
      validateRollcallQuery({
        corpus: "parliamentVotes",
        parentQuery,
        relationship: "sessionVotes",
      }).ok,
    ).toBe(true);
    expect(
      validateRollcallQuery({
        corpus: "councilCasts",
        parentQuery,
        relationship: "sessionVotes",
      }).ok,
    ).toBe(false);
    expect(decodeRollcallQuery("%zz").ok).toBe(false);
  });
  it("renders the absolute date interval and person scope", () => {
    const q = validateRollcallQuery({
      corpus: "parliamentCasts",
      seatIds: ["52:5254"],
      from: "2025-04-01",
      toExclusive: "2026-02-01",
    });
    expect(q.ok && rollcallScope(q.query, "bg")).toContain(
      "2025-04-01 ≤ дата < 2026-02-01",
    );
  });
});

it.each(["constructor", "toString", "__proto__"])(
  "rejects inherited field/topic %s",
  (key) => {
    expect(
      validateRollcallQuery(
        JSON.parse(`{"corpus":"parliamentVotes","${key}":"x"}`),
      ).ok,
    ).toBe(false);
    expect(
      validateRollcallQuery({ corpus: "parliamentVotes", topicIds: [key] }).ok,
    ).toBe(false);
  },
);
it("rejects oversized Unicode and nested parent URLs before encoding", () => {
  const q = {
    corpus: "parliamentCasts",
    factionIds: Array.from({ length: 100 }, (_, i) => "я".repeat(240) + i),
  };
  expect(validateRollcallQuery(q).ok).toBe(false);
  expect(() => encodeRollcallQuery(q)).toThrow("query_too_large");
  const parent = encodeRollcallQuery({
    corpus: "parliamentVotes",
    keyword: "я".repeat(490),
  });
  const child = {
    corpus: "parliamentCasts",
    parentQuery: parent,
    relationship: "voteCasts",
  };
  expect(decodeRollcallQuery(encodeRollcallQuery(child))).toEqual(
    validateRollcallQuery(child),
  );
});
it("source-only council identity pins an exact cast, not all-history name", () => {
  expect(
    validateRollcallQuery({
      corpus: "councilCasts",
      councilIds: ["SOF"],
      councilCastKeys: ["Иван Иванов"],
    }).ok,
  ).toBe(false);
  const q = {
    corpus: "councilCasts",
    councilIds: ["SOF"],
    councilCastKeys: [
      "SOF-2025-prot1-r1::иваниванов",
      "SOF-2020-prot1-r1::иваниванов",
    ],
  };
  expect(decodeRollcallQuery(encodeRollcallQuery(q))).toEqual(
    validateRollcallQuery(q),
  );
});
