// `formatEurSigned` exists because `formatEur` renders a negative as
// „€-1 365 386" — the minus between the symbol and the digits. On a deficit or
// a variance column, where the sign IS the information, that is the one place
// it must not sit.

import { describe, it, expect } from "vitest";
import {
  BGN_PER_EUR,
  formatEur,
  formatEurSigned,
  formatEurCompact,
  formatEurCompactSigned,
  formatNative,
  isEurConvertible,
  toEur,
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

// The register spells its currencies by hand, in Cyrillic, with homoglyph typos. Before these
// folds, 30 asset rows carrying „евро"/„Евро"/„ЕВРО" were treated as an unknown currency and
// stored with a NULL value_eur — silently dropping €914,455 out of the wealth aggregates.
// See docs/plans/declaration-fx-conversion-v1.md.
describe("the register's own currency spellings", () => {
  it("folds every euro spelling to the identity rate", () => {
    for (const spelling of ["евро", "Евро", "ЕВРО", "евра", "ЕUR", "EUR"]) {
      expect(toEur(1000, spelling), spelling).toBe(1000);
      expect(isEurConvertible(spelling), spelling).toBe(true);
    }
  });

  it("folds every lev spelling — punctuation included — to the locked peg", () => {
    for (const spelling of [
      "BGN",
      "лв",
      "лв.",
      "ЛВ.",
      "лева",
      "лев",
      "ВGN",
      "ФЖХ",
    ]) {
      expect(toEur(BGN_PER_EUR, spelling), spelling).toBeCloseTo(1, 10);
    }
  });

  // The bug this ordering prevents: with the rates keyed on the SPELLINGS rather than on a
  // canonical code, formatNative asks "is it in the rate table and not the string 'EUR'?" and
  // renders every euro spelling as лв.
  it("renders a euro spelling as €, never as лв", () => {
    for (const spelling of ["евро", "ЕВРО", "ЕUR"]) {
      expect(formatNative(1234, spelling, "en"), spelling).toBe("€1,234");
    }
    expect(formatNative(1234, "лв.", "en")).toBe("1,234 лв");
  });

  // A currency we convert at a DATED rate must never fold at a fixed one — that is the whole
  // separation between this module and scripts/declarations/fx.ts.
  it("keeps the floating currencies out of the fixed-rate table", () => {
    for (const spelling of ["USD", "GBP", "CHF", "УСД", "шв. фр."]) {
      expect(toEur(1000, spelling), spelling).toBeNull();
      expect(isEurConvertible(spelling), spelling).toBe(false);
    }
  });
});
