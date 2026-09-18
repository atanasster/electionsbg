// The perturbations must look like real user input, be reproducible, and change
// only the wording — or the robustness figures measure the generator instead of
// the routers.
import { describe, expect, it } from "vitest";
import { latin, typo } from "./jevRobustness";

describe("typo", () => {
  const q = "Каква беше избирателната активност в Пловдив?";

  it("is reproducible for the same seed, and varies across seeds", () => {
    expect(typo(q, "a")).toBe(typo(q, "a"));
    const seeds = ["a", "b", "c", "d", "e"].map((s) => typo(q, s));
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  it("changes at most two words, by one letter each, keeping the first letter", () => {
    const before = q.split(" ");
    const after = typo(q, "seed").split(" ");
    expect(after).toHaveLength(before.length);
    const changed = before
      .map((w, i) => [w, after[i]] as const)
      .filter(([a, b]) => a !== b);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.length).toBeLessThanOrEqual(2);
    for (const [a, b] of changed) {
      expect(b[0]).toBe(a[0]);
      expect(Math.abs(a.length - b.length)).toBeLessThanOrEqual(1);
    }
  });

  it("leaves short words alone", () => {
    expect(typo("Кой е ГЕРБ?", "x")).toBe("Кой е ГЕРБ?");
  });
});

describe("latin", () => {
  it("types Bulgarian in Latin letters and keeps punctuation", () => {
    expect(latin("Къде е бюджетът?")).toBe("kade e byudzhetat?");
  });

  it("passes Latin text through unchanged", () => {
    expect(latin("GERB 2024?")).toBe("GERB 2024?");
  });
});
