// The pure halves of the EUR currency verifier: parsing ЕОП amounts, the join keys, and the two
// verdicts it reports. The script itself is read-only over gitignored caches and is run by hand.

import { describe, expect, it } from "vitest";
import {
  classify,
  joinKeys,
  parseEopAmount,
  ratioBand,
  type EopCurrencyRow,
} from "./verify_eur_currency_eop";

const eop = (o: Partial<EopCurrencyRow>): EopCurrencyRow => ({
  unp: "00159-2024-0006",
  contractNumber: "1",
  supplierEik: "123456789",
  contractValue: 1000,
  currency: "EUR",
  contractCurrency: "EUR",
  day: "2024-03-05",
  ...o,
});

describe("parseEopAmount", () => {
  it("reads the feed's comma decimal and spaced thousands", () => {
    expect(parseEopAmount("751832,33")).toBe(751832.33);
    expect(parseEopAmount("1 234,50")).toBe(1234.5);
  });
  it("returns null rather than zero for nothing", () => {
    expect(parseEopAmount("")).toBeNull();
    expect(parseEopAmount(null)).toBeNull();
    expect(parseEopAmount("n/a")).toBeNull();
  });
});

describe("joinKeys", () => {
  it("needs a УНП for either key — a T-id procedure cannot join the legacy CSV", () => {
    expect(joinKeys("", "1", "123")).toEqual({ byNumber: null, byEik: null });
    expect(joinKeys("U", "1", "123")).toEqual({
      byNumber: "U|n|1",
      byEik: "U|e|123",
    });
  });
});

describe("classify", () => {
  it("a BGN record with the same number means the legacy EUR label is wrong", () => {
    const c = classify(1000, eop({ currency: "BGN", contractCurrency: "BGN" }));
    expect(c).toEqual({
      fields: "agree",
      eopSays: "BGN",
      amountCheck: "equal",
    });
  });
  it("names a disagreement between the two ЕОП fields rather than picking one", () => {
    expect(
      classify(1000, eop({ currency: "BGN", contractCurrency: "EUR" })).eopSays,
    ).toBe("BGN/EUR");
  });
  it("treats a zero contract value as no value, not as a mismatch", () => {
    expect(classify(1000, eop({ contractValue: 0 })).amountCheck).toBe(
      "no-value",
    );
  });
});

describe("ratioBand — the contract against its own estimate", () => {
  it("EUR-scale against a BGN estimate", () => {
    expect(ratioBand(500, 1000)).toBe("eur-scale");
  });
  it("same-scale means the contract is in the estimate's unit", () => {
    expect(ratioBand(950, 1000)).toBe("same-scale");
  });
  it("leaves the extremes undecided", () => {
    expect(ratioBand(100, 1000)).toBe("ambiguous");
    expect(ratioBand(3000, 1000)).toBe("ambiguous");
    expect(ratioBand(1000, null)).toBe("no-ratio");
  });
});
