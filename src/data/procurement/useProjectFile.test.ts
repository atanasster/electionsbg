import { describe, it, expect } from "vitest";
import { parseProjectSpec } from "./useProjectFile";

describe("parseProjectSpec — untrusted ?q= parsing (§4.1)", () => {
  it("accepts a valid spec", () => {
    const raw = JSON.stringify({
      search: [{ terms: "западна дъга", distinctive: ["дъга"] }],
    });
    const s = parseProjectSpec(raw);
    expect(s?.search[0].terms).toBe("западна дъга");
  });

  it("rejects null / bad JSON / non-object", () => {
    expect(parseProjectSpec(null)).toBeNull();
    expect(parseProjectSpec("{not json")).toBeNull();
    expect(parseProjectSpec("42")).toBeNull();
    expect(parseProjectSpec('"a string"')).toBeNull();
  });

  it("rejects a missing or empty search", () => {
    expect(parseProjectSpec(JSON.stringify({}))).toBeNull();
    expect(parseProjectSpec(JSON.stringify({ search: [] }))).toBeNull();
  });

  it("rejects a thread with non-string / empty terms", () => {
    expect(
      parseProjectSpec(JSON.stringify({ search: [{ terms: 5 }] })),
    ).toBeNull();
    expect(
      parseProjectSpec(JSON.stringify({ search: [{ terms: "" }] })),
    ).toBeNull();
    expect(parseProjectSpec(JSON.stringify({ search: [{}] }))).toBeNull();
  });

  it("bounds the include/exclude id-lists (breadth guard)", () => {
    const bigKeys = Array.from({ length: 5000 }, (_, i) => `k${i}`);
    const s = parseProjectSpec(
      JSON.stringify({
        search: [{ terms: "x" }],
        includes: { contractKeys: bigKeys },
      }),
    );
    expect(s?.includes?.contractKeys?.length).toBeLessThanOrEqual(500);
  });

  it("caps the number of search threads", () => {
    const many = Array.from({ length: 100 }, () => ({ terms: "x" }));
    const s = parseProjectSpec(JSON.stringify({ search: many }));
    expect(s?.search.length).toBeLessThanOrEqual(20);
  });

  it("shape-checks + bounds the untrusted claims[] (§4.2.6b)", () => {
    const s = parseProjectSpec(
      JSON.stringify({
        search: [{ terms: "x" }],
        claims: [
          { text: "валидно", verdict: "confirms" },
          { text: "лош вердикт", verdict: "hacked" }, // verdict dropped
          { text: 5 }, // non-string text → dropped
          {}, // no text → dropped
        ],
      }),
    );
    expect(s?.claims).toHaveLength(2);
    expect(s?.claims?.[0].verdict).toBe("confirms");
    expect(s?.claims?.[1].verdict).toBeUndefined();
  });

  it("drops claims[] entirely when none are well-formed", () => {
    const s = parseProjectSpec(
      JSON.stringify({ search: [{ terms: "x" }], claims: [{}, { text: 1 }] }),
    );
    expect(s?.claims).toBeUndefined();
  });

  it("caps claims[] at 20", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ text: `c${i}` }));
    const s = parseProjectSpec(
      JSON.stringify({ search: [{ terms: "x" }], claims: many }),
    );
    expect(s?.claims?.length).toBeLessThanOrEqual(20);
  });

  it("shape-checks knownSubcontractors[] + bounds inhouseAwarderEiks (§0g.2)", () => {
    const s = parseProjectSpec(
      JSON.stringify({
        search: [{ terms: "x" }],
        inhouseAwarderEiks: ["831646048", 5], // non-string dropped
        knownSubcontractors: [
          { name: "Нивел строй", eik: "111", amountEur: 413000000 },
          { name: "Bad", amountEur: "lots", source: {} }, // amountEur/source coerced
          { eik: "222" }, // no name → dropped
        ],
      }),
    );
    expect(s?.inhouseAwarderEiks).toEqual(["831646048"]);
    expect(s?.knownSubcontractors).toHaveLength(2);
    expect(s?.knownSubcontractors?.[0].amountEur).toBe(413000000);
    expect(s?.knownSubcontractors?.[1].amountEur).toBeUndefined();
    expect(s?.knownSubcontractors?.[1].source).toBeUndefined();
  });

  it("neutralizes non-string claim fields from untrusted ?q= (no React-child crash)", () => {
    const s = parseProjectSpec(
      JSON.stringify({
        search: [{ terms: "x" }],
        claims: [
          {
            text: "ok",
            byWhom: {},
            saidAt: [],
            ourNumber: {},
            sourceUrl: 5,
            note: { bg: {} },
          },
        ],
      }),
    );
    const c = s?.claims?.[0];
    expect(c?.byWhom).toBeUndefined();
    expect(c?.saidAt).toBeUndefined();
    expect(c?.ourNumber).toBeUndefined();
    expect(c?.sourceUrl).toBeUndefined();
    expect(c?.note).toBeUndefined();
  });
});
