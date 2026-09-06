import { describe, expect, it, vi } from "vitest";
import { FALLBACK_PALETTE, hslTripleToHex, readPalette } from "./palette";
import { mixHex } from "@/lib/flyover/layers";

describe("hslTripleToHex", () => {
  it("converts this repo's own variable form", () => {
    // `--background: 39 33% 92%` — a bare triple, consumed as `hsl(var(--background))`.
    // ⚠️ `#f1ede4`, not the `#F1ECE0` written beside it in App.css: that comment is a
    // human's approximation of the triple, and taking an expected value from a comment
    // rather than from the arithmetic is how a conversion test ends up asserting a typo.
    expect(hslTripleToHex("39 33% 92%")).toBe("#f1ede4");
    expect(hslTripleToHex("0 0% 0%")).toBe("#000000");
    expect(hslTripleToHex("0 0% 100%")).toBe("#ffffff");
    expect(hslTripleToHex("0 100% 50%")).toBe("#ff0000");
    expect(hslTripleToHex("120 100% 50%")).toBe("#00ff00");
    expect(hslTripleToHex("240 100% 50%")).toBe("#0000ff");
  });

  it("covers every sextant of the wheel", () => {
    // The conversion is a six-branch switch; a single colour would exercise one of them.
    for (const h of [30, 90, 150, 210, 270, 330]) {
      const hex = hslTripleToHex(`${h} 60% 50%`);
      expect(hex, `${h}deg`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("returns null for anything that is not a triple", () => {
    // ⚠️ NULL, NOT A GUESS. `getComputedStyle` returns `""` for an unset variable and
    // `rgb(…)` for a resolved colour property; a partial parse of either would put a
    // half-invented colour into the scene.
    for (const bad of [
      "",
      "  ",
      "rgb(1,2,3)",
      "#f1ece0",
      "39 33 92",
      "hsl(39 33% 92%)",
    ]) {
      expect(hslTripleToHex(bad), bad).toBeNull();
    }
  });

  it("wraps hue and clamps the two percentages", () => {
    expect(hslTripleToHex("360 100% 50%")).toBe(hslTripleToHex("0 100% 50%"));
    expect(hslTripleToHex("-30 100% 50%")).toBe(hslTripleToHex("330 100% 50%"));
    expect(hslTripleToHex("0 200% 150%")).toBe("#ffffff");
  });
});

describe("readPalette", () => {
  it("is complete and entirely hex, whatever it read", () => {
    // ⚠️ THE WHOLE POINT. `mixHex` parses hex and NOTHING else — for anything else it returns
    // the nearer end, which flattens the column shading, posterises the price ramp and turns
    // the election cross-fade into a hard cut, all at once, at a 200. A palette that leaked one
    // CSS value through would do that silently.
    for (const palette of [readPalette(), FALLBACK_PALETTE]) {
      const values = [
        ...Object.values(palette).filter((v) => typeof v === "string"),
        ...Object.values(palette.column),
      ] as string[];
      expect(values.length).toBeGreaterThan(9);
      for (const v of values) expect(v).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("actually mixes, which a non-hex palette would not", () => {
    // The mutation check for the paragraph above: with a CSS colour in it, this returns an
    // endpoint instead of a blend.
    const p = readPalette();
    const mixed = mixHex(p.land, p.column.proc, 0.5);
    expect(mixed).not.toBe(p.land);
    expect(mixed).not.toBe(p.column.proc);
  });

  it("keeps the brand's meaning-bearing colours fixed", () => {
    // Which layer, which direction, cheaper or dearer: a meaning that changed colour with the
    // theme would have to be re-learned in the dark.
    const p = readPalette();
    expect(p.column).toEqual(FALLBACK_PALETTE.column);
    expect(p.arcIn).toBe(FALLBACK_PALETTE.arcIn);
    expect(p.arcOut).toBe(FALLBACK_PALETTE.arcOut);
    expect(p.priceUp).toBe(FALLBACK_PALETTE.priceUp);
    expect(p.priceDown).toBe(FALLBACK_PALETTE.priceDown);
  });

  it("falls back rather than throwing when the environment has no styles", () => {
    vi.stubGlobal("getComputedStyle", undefined);
    expect(readPalette()).toEqual(FALLBACK_PALETTE);
    vi.stubGlobal("getComputedStyle", () => {
      throw new Error("blocked");
    });
    expect(readPalette()).toEqual(FALLBACK_PALETTE);
    vi.unstubAllGlobals();
  });

  it("reads a variable when the document has one", () => {
    const el = document.createElement("div");
    el.style.setProperty("--card", "0 0% 100%");
    document.body.append(el);
    expect(readPalette(el).land).toBe("#ffffff");
    el.remove();
  });
});
