import { describe, expect, it } from "vitest";
import { kmetstvoNameKey } from "./kmetstvoName";

describe("kmetstvoNameKey", () => {
  it("folds case, whitespace and composition", () => {
    expect(kmetstvoNameKey("  Горна   Малина ")).toBe("горна малина");
    expect(kmetstvoNameKey("ГЛАВА")).toBe(kmetstvoNameKey("глава"));
  });

  it("normalizes BEFORE lower-casing, which is the load-bearing order", () => {
    // ⚠ A DECOMPOSED `й` IS A DIFFERENT STRING. `и` + U+0306 lower-cases to itself and would
    // never equal the composed spelling, so a copy that dropped `normalize` — or applied it
    // after `toLowerCase` — would silently stop matching every name carrying one. This is the
    // detail that made six hand-written copies a hazard rather than mere repetition.
    const decomposed = "Своге:".replace(":", "") + "й";
    const composed = decomposed.normalize("NFC");
    expect(decomposed).not.toBe(composed);
    expect(kmetstvoNameKey(decomposed)).toBe(kmetstvoNameKey(composed));
  });
});
