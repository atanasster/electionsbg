import { describe, it, expect } from "vitest";
import { formatOwnerShare, formatOwnerAmount } from "./ownerShare";

describe("formatOwnerShare", () => {
  it("renders an absent share as an em dash, never as a number", () => {
    // NULL is "we cannot express this stake as a fraction of the current
    // capital" — 7,769 companies legitimately publish no percentage at all.
    for (const v of [null, undefined, ""]) {
      expect(formatOwnerShare(v)).toBe("—");
    }
  });

  it("does not treat a sole owner's NULL as 100%", () => {
    // The regression guard. The server returns 100 itself for a lone
    // sole_owner; a NULL means it shares its vintage with active partners,
    // and answering 100% there is what produced 200.8% totals.
    expect(formatOwnerShare(null)).toBe("—");
  });

  it("keeps one decimal so a column of shares still sums to 100", () => {
    // БИЛЯНА ООД (104119056) — the report that opened this work.
    expect(formatOwnerShare(75.5411)).toBe("75,5%");
    expect(formatOwnerShare(24.4589)).toBe("24,5%");
    // Whole-number rounding renders three equal owners as 33+33+33 = 99.
    expect(formatOwnerShare(33.3333)).toBe("33,3%");
  });

  it("drops a trailing zero so a whole percentage stays whole", () => {
    expect(formatOwnerShare(100)).toBe("100%");
    expect(formatOwnerShare(50)).toBe("50%");
  });

  it("accepts the string node-postgres returns for a numeric column", () => {
    // pg serialises PG `numeric` as a string; both call sites pass it through.
    expect(formatOwnerShare("75.5411")).toBe("75,5%");
    expect(formatOwnerShare("100")).toBe("100%");
  });

  it("refuses a value that is not a number rather than printing NaN", () => {
    expect(formatOwnerShare("n/a")).toBe("—");
  });
});

describe("formatOwnerShare edge cases", () => {
  it("renders a real zero as 0%, never as an em dash", () => {
    // 0 = "owns nothing, and we know it"; null = "no answer". The distinction
    // is the whole design — a falsy check would erase every real zero.
    expect(formatOwnerShare(0)).toBe("0%");
    expect(formatOwnerShare("0")).toBe("0%");
  });

  it("renders the server's own 100 for a lone sole owner", () => {
    // The other half of the sole_owner guard: the server returns 100 itself,
    // so the client never infers it from the role.
    expect(formatOwnerShare(100)).toBe("100%");
  });

  it("refuses a blank string rather than publishing 0%", () => {
    // Number(" ") is 0, not NaN — an all-whitespace cell would otherwise
    // assert that a named person owns nothing.
    for (const v of [" ", "\t", "\n"]) expect(formatOwnerShare(v)).toBe("—");
  });
});

describe("formatOwnerAmount", () => {
  it("prefers share_eur — the figure the percentage is built from", () => {
    expect(formatOwnerAmount(6428.58, 6428.58, "EUR")).toBe("6428,58 EUR");
    // The disagreeing case: several records in one vintage. The percentage is
    // built from the sum, so the parenthetical must show the sum too.
    expect(formatOwnerAmount(9000, 6428.58, "EUR")).toBe("9000 EUR");
  });

  it("falls back to the declared record when there is no percentage", () => {
    // A row outside the current cap table has no share_eur; its declared
    // amount is still a true fact about that filing.
    //
    // Matched loosely on the thousands separator: bg-BG groups with a no-break
    // space whose exact codepoint is ICU-version data, not something this
    // module promises. What IS asserted is the digits, the decimal comma and
    // the currency suffix.
    expect(formatOwnerAmount(null, 12564, null)).toMatch(/^12\s?564$/);
    expect(formatOwnerAmount(null, 12564, "BGN")).toMatch(/^12\s?564 BGN$/);
    expect(formatOwnerAmount(null, "2081.46", "EUR")).toBe("2081,46 EUR");
  });

  it("returns null when there is nothing to show", () => {
    expect(formatOwnerAmount(null, null, null)).toBeNull();
    expect(formatOwnerAmount(null, "", "EUR")).toBeNull();
  });
});
