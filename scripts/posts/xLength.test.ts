import { describe, it, expect } from "vitest";
import { X_LIMIT, X_URL_WEIGHT, xWeightedLength } from "./xLength";

describe("xWeightedLength", () => {
  it("counts Cyrillic at 1 per character, like Latin", () => {
    // The trap this guards: a UTF-8 byte count would make Bulgarian cost double
    // and silently halve the usable budget of every BG post we write.
    expect(xWeightedLength("абв")).toBe(3);
    expect(xWeightedLength("abc")).toBe(3);
    expect(xWeightedLength("Културата не е изключение")).toBe(25);
  });

  it("counts any URL as X_URL_WEIGHT, whatever its real length", () => {
    const short = "https://a.bg";
    const long = "https://electionsbg.com/culture/procurement?pscope=all";
    expect(long.length).toBeGreaterThan(short.length);
    expect(xWeightedLength(short)).toBe(X_URL_WEIGHT);
    expect(xWeightedLength(long)).toBe(X_URL_WEIGHT);
  });

  it("adds the URL weight to the surrounding text rather than replacing it", () => {
    expect(xWeightedLength("виж: https://a.bg")).toBe(5 + X_URL_WEIGHT);
  });

  it("counts several URLs independently", () => {
    expect(xWeightedLength("https://a.bg https://b.bg")).toBe(
      X_URL_WEIGHT * 2 + 1,
    );
  });

  it("accepts a real post at the limit and rejects one past it", () => {
    const body =
      "40,4% от договорите на културните институции са възложени с една " +
      "оферта. За всички обществени поръчки в страната: 40,9%.\n\n" +
      "https://electionsbg.com/culture/procurement?pscope=all";
    expect(xWeightedLength(body)).toBeLessThanOrEqual(X_LIMIT);
    expect(xWeightedLength(`${body}\n${"х".repeat(X_LIMIT)}`)).toBeGreaterThan(
      X_LIMIT,
    );
  });

  it("a URL runs to the next whitespace, so trailing text is not swallowed", () => {
    // The regex is \S+, so text glued to a URL with no separator counts as part
    // of it. Real copy always puts a space or newline after a link, and the
    // error is bounded to trailing punctuation — but it under-counts, which is
    // the dangerous direction for a gate, so it is pinned here deliberately.
    expect(xWeightedLength("https://a.bg следва")).toBe(X_URL_WEIGHT + 7);
  });

  it("is not satisfied by a naive .length — the URL case is the difference", () => {
    // Mutation check: if xWeightedLength ever degrades to `text.length`, this
    // fails. Without it the whole module could be replaced by `.length` and
    // every other assertion here would still pass.
    const withUrl = "x https://electionsbg.com/culture/procurement?pscope=all";
    expect(xWeightedLength(withUrl)).not.toBe(withUrl.length);
  });
});
