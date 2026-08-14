// `formatEurSigned` exists because `formatEur` renders a negative as
// „€-1 365 386" — the minus between the symbol and the digits. On a deficit or
// a variance column, where the sign IS the information, that is the one place
// it must not sit.

import { describe, it, expect } from "vitest";
import {
  formatEur,
  formatEurSigned,
  formatEurCompact,
  formatEurCompactSigned,
} from "./currency";

/** `formatEur` groups with NBSP (U+00A0), so a literal typed with ordinary
 *  spaces compares unequal to a visually identical string. */
const sp = (v: string) => v.replace(/\u00a0/g, " ");

describe("formatEurSigned", () => {
  it("puts the sign in front of the symbol, not inside it", () => {
    // formatEur(-1365386) is „€-1 365 386" — the minus sits between the symbol
    // and the digits, which is what this exists to avoid on a column that is
    // read for direction.
    expect(sp(formatEurSigned(-1365386))).toBe("−€1 365 386");
    expect(sp(formatEur(-1365386))).toBe("€-1 365 386");
  });

  it("uses a real minus, not a hyphen", () => {
    expect(formatEurSigned(-5)).toContain("−");
    expect(formatEurSigned(-5)).not.toContain("-");
  });

  it("adds + only when asked, and never to zero", () => {
    expect(sp(formatEurSigned(70291516))).toBe("€70 291 516");
    expect(
      sp(formatEurSigned(70291516, "bg-BG", { plusForPositive: true })),
    ).toBe("+€70 291 516");
    expect(formatEurSigned(0, "bg-BG", { plusForPositive: true })).toBe("€0");
  });

  it("honours locale and decimals rather than hard-coding bg-BG", () => {
    // Both were unheld: hard-coding "bg-BG" or dropping `opts` left the suite
    // green, so a caller passing either would have been silently ignored.
    expect(sp(formatEurSigned(-1234.5, "en-US", { decimals: 2 }))).toBe(
      "−€1,234.50",
    );
    // bg-BG groups from five digits, so use a number where it shows.
    expect(sp(formatEurSigned(-1234567.5, "bg-BG", { decimals: 2 }))).toBe(
      "−€1 234 567,50",
    );
  });

  it("returns empty for null and non-finite, like formatEur", () => {
    expect(formatEurSigned(null)).toBe("");
    expect(formatEurSigned(Number.NaN)).toBe("");
  });
});

describe("formatEurCompactSigned", () => {
  it("signs a compact deficit in front of the symbol", () => {
    // formatEurCompact buries the minus: „€-1,9 млрд.".
    expect(formatEurCompactSigned(-1914405872)).toMatch(/^−€/);
    expect(formatEurCompact(-1914405872)).toMatch(/^€-/);
  });

  it("leaves a surplus unsigned unless asked", () => {
    expect(formatEurCompactSigned(1914405872)).toMatch(/^€/);
    expect(
      formatEurCompactSigned(1914405872, "bg-BG", { plusForPositive: true }),
    ).toMatch(/^\+€/);
  });

  it("returns empty for null and non-finite", () => {
    expect(formatEurCompactSigned(null)).toBe("");
    expect(formatEurCompactSigned(Number.NaN)).toBe("");
  });
});
