import { describe, expect, it } from "vitest";
import {
  carriesDisplayNumber,
  displayNumbers,
  numericTokens,
} from "./gate1Numbers";

const token = (text: string) => displayNumbers(text)[0]!;

describe("Gate 1 display-number grounding", () => {
  it("matches canonical fractions, euro amounts, and exact values", () => {
    expect(carriesDisplayNumber(0.566, token("56,6%"))).toBe(true);
    expect(carriesDisplayNumber(16_096_493_169, token("16,1 млрд."))).toBe(
      true,
    );
    expect(carriesDisplayNumber(819, token("819 млн."))).toBe(true);
    expect(numericTokens("407 512 · €16,1 млрд. · 56,6%")).toEqual([
      "407 512",
      "16,1",
      "56,6",
    ]);
  });

  it("rejects neighboring values and unit collisions", () => {
    expect(carriesDisplayNumber(0.566, token("56,7%"))).toBe(false);
    expect(carriesDisplayNumber(16_096_493_169, token("16,2 млрд."))).toBe(
      false,
    );
    expect(carriesDisplayNumber(819, token("820 млн."))).toBe(false);
    expect(carriesDisplayNumber(0.566, token("56,6"))).toBe(false);
    expect(carriesDisplayNumber(16_096_493_169, token("16,1%"))).toBe(false);
  });

  it("honors the displayed precision at a rounding boundary", () => {
    expect(carriesDisplayNumber(16_149_999_999, token("16,1 млрд."))).toBe(
      true,
    );
    expect(carriesDisplayNumber(16_150_100_000, token("16,1 млрд."))).toBe(
      false,
    );
  });
});
