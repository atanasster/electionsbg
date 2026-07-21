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
});
