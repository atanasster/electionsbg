// SEED EXAMPLE — the "pure util" layer. See docs/testing-standards.md.
//
// A pure, deterministic function (Latin/Cyrillic search folding) is the easiest
// and highest-value thing to unit-test: no DOM, no network, no DB — just
// input -> output. Co-located next to the module it tests, named *.test.ts.
// New tests should prefer Vitest's `expect` (as here) over node:assert.
import { describe, expect, it } from "vitest";
import { latinSkeleton, skeletonMatches } from "./translitSearch";

describe("latinSkeleton", () => {
  it("transliterates Cyrillic to a Latin skeleton", () => {
    expect(latinSkeleton("Строителни")).toBe("stroitelni");
  });

  it("folds ч and х (and a typed 'ch') to the same 'h'", () => {
    // "Архитектурни", "arhitekturni" and "architekturni" must all collapse.
    expect(latinSkeleton("Архитектурни")).toBe("arhitekturni");
    expect(latinSkeleton("arhitekturni")).toBe("arhitekturni");
    expect(latinSkeleton("architekturni")).toBe("arhitekturni");
  });

  it("strips punctuation and whitespace", () => {
    expect(latinSkeleton("АЕЦ — Козлодуй, бл.5")).toBe("aetskozloduybl5");
  });
});

describe("skeletonMatches", () => {
  it("matches a Latin needle against Cyrillic text (shljokavica input)", () => {
    expect(skeletonMatches("Архитектурни услуги", "arh")).toBe(true);
    expect(skeletonMatches("Архитектурни услуги", "arch")).toBe(true);
  });

  it("is a non-match when the folded needle is absent", () => {
    expect(skeletonMatches("Строителни работи", "arh")).toBe(false);
  });

  it("treats an empty needle as a match (no filter applied)", () => {
    expect(skeletonMatches("каквото и да е", "")).toBe(true);
  });
});
