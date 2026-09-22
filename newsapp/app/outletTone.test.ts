import { describe, it, expect } from "vitest";
import {
  dominantTone,
  outletGroup,
  outletGroupKey,
  TONE_GROUP_ORDER,
} from "./outletTone";

describe("dominantTone", () => {
  it("names the tone an outlet's coverage mostly carries", () => {
    expect(dominantTone({ neutral: 3, unfavorable: 1 })).toBe("neutral");
    expect(dominantTone({ unfavorable: 2 })).toBe("unfavorable");
  });

  it("returns null on a tie rather than the first in the order", () => {
    // ⚠️ `favorable` is first, so returning the leader on a tie would make a
    // 1-1 split read as favourable coverage of a named party by a named
    // outlet — a claim produced by an array's order.
    expect(TONE_GROUP_ORDER[0]).toBe("favorable");
    expect(dominantTone({ favorable: 1, unfavorable: 1 })).toBeNull();
    expect(
      dominantTone({ favorable: 2, neutral: 2, unfavorable: 1 }),
    ).toBeNull();
  });

  it("clears an earlier tie when a clear winner arrives after it", () => {
    // ⚠️ THE MUTATION THIS EXISTS TO KILL. Dropping the `tied = false` reset
    // leaves the two equal runners-up marking the result tied for ever, so a
    // clear winner arriving last returns null.
    expect(dominantTone({ favorable: 1, neutral: 1, unfavorable: 3 })).toBe(
      "unfavorable",
    );
    expect(dominantTone({ favorable: 2, neutral: 2, unfavorable: 9 })).toBe(
      "unfavorable",
    );
  });

  it("returns null when nothing was assessed", () => {
    expect(dominantTone({})).toBeNull();
    expect(dominantTone(null)).toBeNull();
    expect(dominantTone(undefined)).toBeNull();
    expect(dominantTone({ favorable: 0, neutral: 0 })).toBeNull();
  });

  it("ignores a non-finite or negative count instead of ranking on it", () => {
    expect(dominantTone({ favorable: Number.NaN, neutral: 1 })).toBe("neutral");
    expect(dominantTone({ favorable: -5, neutral: 1 })).toBe("neutral");
  });

  it("is unaffected by the key order of the object", () => {
    expect(dominantTone({ unfavorable: 3, favorable: 1 })).toBe("unfavorable");
    expect(dominantTone({ favorable: 1, unfavorable: 3 })).toBe("unfavorable");
  });
});

describe("outletGroup", () => {
  it("calls two or more assessed with one leader dominant", () => {
    expect(outletGroup({ unfavorable: 3, neutral: 1 }, 4)).toEqual({
      kind: "dominant",
      tone: "unfavorable",
    });
  });

  it("never calls a single article 'mostly'", () => {
    // ⚠️ „преобладаващо негативен" over one article is a word the evidence
    // does not reach.
    expect(outletGroup({ unfavorable: 1 }, 1)).toEqual({
      kind: "single",
      tone: "unfavorable",
    });
  });

  it("separates 'we published no assessment' from 'no single framing'", () => {
    // ⚠️ „без преобладаваща рамка" asserts we looked and found none; with
    // nothing assessed, the truth is that we published no assessment at all.
    expect(outletGroup({}, 0)).toEqual({ kind: "unassessed" });
    expect(outletGroup({ favorable: 1, unfavorable: 1 }, 2)).toEqual({
      kind: "split",
    });
  });

  it("treats a missing or nonsensical assessed count as unassessed", () => {
    expect(outletGroup({ favorable: 3 }, 0)).toEqual({ kind: "unassessed" });
    expect(outletGroup({ favorable: 3 }, Number.NaN)).toEqual({
      kind: "unassessed",
    });
    expect(outletGroup({ favorable: 3 }, -2)).toEqual({ kind: "unassessed" });
  });

  it("gives every group a distinct stable key", () => {
    const keys = [
      outletGroupKey({ kind: "dominant", tone: "favorable" }),
      outletGroupKey({ kind: "single", tone: "favorable" }),
      outletGroupKey({ kind: "split" }),
      outletGroupKey({ kind: "unassessed" }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});
