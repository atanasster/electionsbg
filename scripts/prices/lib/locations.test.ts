// EKATTE normalization + population banding + place resolution for the price
// ingest. Pure logic; the module reads the settlements + census JSON at import,
// so resolvePlace's Sofia special-case and the null path are asserted against
// the real tree without needing a database.

import { describe, it, expect } from "vitest";
import { normalizeEkatte, popBand, resolvePlace } from "./locations";

describe("normalizeEkatte", () => {
  it("keeps a clean 5-digit code unchanged", () => {
    expect(normalizeEkatte("68134")).toBe("68134");
  });

  it("trims surrounding whitespace and quotes", () => {
    expect(normalizeEkatte('  "00151"  ')).toBe("00151");
  });

  it("strips a leading BOM", () => {
    expect(normalizeEkatte("﻿12345")).toBe("12345");
  });

  it("drops a Sofia-district suffix", () => {
    expect(normalizeEkatte("68134-01")).toBe("68134");
  });

  it("zero-pads a short code to 5 digits", () => {
    expect(normalizeEkatte("151")).toBe("00151");
  });
});

describe("popBand", () => {
  it("bands a null population to the smallest class", () => {
    expect(popBand(null)).toBe("S");
  });

  it("bands by the size thresholds", () => {
    expect(popBand(500_000)).toBe("XL");
    expect(popBand(50_000)).toBe("L");
    expect(popBand(15_000)).toBe("M");
    expect(popBand(5_000)).toBe("S");
  });

  it("treats each threshold as inclusive of its lower bound", () => {
    expect(popBand(100_000)).toBe("XL");
    expect(popBand(30_000)).toBe("L");
    expect(popBand(10_000)).toBe("M");
  });
});

describe("resolvePlace", () => {
  it("synthesizes the Sofia city node for EKATTE 68134", () => {
    const p = resolvePlace("68134");
    expect(p).toMatchObject({
      ekatte: "68134",
      name: "София",
      nameEn: "Sofia",
      obshtina: "SOF46",
      popBand: "XL",
    });
  });

  it("applies normalization before resolving (a suffixed Sofia still resolves)", () => {
    expect(resolvePlace("68134-07")?.obshtina).toBe("SOF46");
  });

  it("returns null for a code absent from the settlement tree", () => {
    expect(resolvePlace("ZZZZZ")).toBeNull();
  });
});
