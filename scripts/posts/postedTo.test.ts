import { describe, expect, it } from "vitest";
import {
  formatPosted,
  isPostedTo,
  mergePosted,
  parseChannels,
  removePosted,
} from "./postedTo";

describe("parseChannels", () => {
  it("accepts comma- and space-separated forms and dedupes", () => {
    expect(parseChannels(["fb-page,ig", "li"])).toEqual([
      "fb-page",
      "ig",
      "li",
    ]);
    expect(parseChannels(["IG", "ig"])).toEqual(["ig"]);
  });

  it("throws on an unknown channel rather than dropping it", () => {
    // Silently ignoring a typo would record the post as never published.
    expect(() => parseChannels(["instagram"])).toThrow(/unknown channel/);
    expect(() => parseChannels([])).toThrow(/no channels/);
  });

  it("refuses a bare fb and names the two real options", () => {
    // The Page and the Group are different audiences with different pin flows.
    expect(() => parseChannels(["fb"])).toThrow(/fb-page/);
    expect(() => parseChannels(["facebook"])).toThrow(/fb-group/);
  });
});

describe("mergePosted", () => {
  it("adds a stamp to an entry with no history", () => {
    const { next, added } = mergePosted(undefined, ["ig"], "2026-08-14");
    expect(next).toEqual([{ channel: "ig", at: "2026-08-14" }]);
    expect(added).toEqual(["ig"]);
  });

  it("keeps the ORIGINAL date when the channel is already recorded", () => {
    // "Has this been published here" is answered by the first time it went out.
    const prior = [{ channel: "fb-page" as const, at: "2026-08-02" }];
    const { next, added, kept } = mergePosted(prior, ["fb-page"], "2026-08-14");
    expect(next).toEqual(prior);
    expect(added).toEqual([]);
    expect(kept).toEqual(["fb-page"]);
  });

  it("overwrites the date only when asked", () => {
    const prior = [{ channel: "fb-page" as const, at: "2026-08-02" }];
    const { next, added } = mergePosted(prior, ["fb-page"], "2026-08-14", true);
    expect(next).toEqual([{ channel: "fb-page", at: "2026-08-14" }]);
    expect(added).toEqual(["fb-page"]);
  });

  it("is idempotent and stable in order, so a re-stamp is an empty diff", () => {
    const once = mergePosted(undefined, ["ig", "fb-page"], "2026-08-14").next;
    const twice = mergePosted(once, ["fb-page", "ig"], "2026-08-14").next;
    expect(twice).toEqual(once);
    expect(once.map((p) => p.channel)).toEqual(["fb-page", "ig"]);
  });

  it("rejects a malformed date", () => {
    expect(() => mergePosted(undefined, ["ig"], "14-08-2026")).toThrow(
      /bad date/,
    );
  });
});

describe("removePosted", () => {
  it("drops only the named channels and reports what went", () => {
    const prior = [
      { channel: "fb-page" as const, at: "2026-08-02" },
      { channel: "ig" as const, at: "2026-08-14" },
    ];
    const { next, removed } = removePosted(prior, ["ig"]);
    expect(next).toEqual([{ channel: "fb-page", at: "2026-08-02" }]);
    expect(removed).toEqual(["ig"]);
  });

  it("is a no-op for a channel that was never recorded", () => {
    const { next, removed } = removePosted(undefined, ["ig"]);
    expect(next).toEqual([]);
    expect(removed).toEqual([]);
  });
});

describe("isPostedTo / formatPosted", () => {
  it("treats absent history as unpublished", () => {
    expect(isPostedTo(undefined, "ig")).toBe(false);
    expect(isPostedTo([], "ig")).toBe(false);
    expect(formatPosted(undefined)).toBe("—");
  });

  it("renders a compact, sorted summary", () => {
    expect(
      formatPosted([
        { channel: "ig", at: "2026-08-14" },
        { channel: "fb-page", at: "2026-08-02" },
      ]),
    ).toBe("fb-page@2026-08-02, ig@2026-08-14");
  });
});
