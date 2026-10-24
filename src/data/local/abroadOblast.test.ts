import { describe, expect, it } from "vitest";
import { ABROAD_CONTINENTS, isAbroadCountryCode } from "./abroadOblast";

describe("isAbroadCountryCode", () => {
  it("recognises ISO country keys, Kosovo's Cyrillic one included", () => {
    expect(isAbroadCountryCode("NZ")).toBe(true);
    expect(isAbroadCountryCode("AU")).toBe(true);
    expect(isAbroadCountryCode("КО")).toBe(true);
  });

  it("leaves the six continent buckets to the município route — AF and SA lose", () => {
    for (const c of ABROAD_CONTINENTS)
      expect(isAbroadCountryCode(c)).toBe(false);
  });

  it("rejects domestic município, район and EKATTE ids", () => {
    for (const id of ["TGV35", "S2401", "SOF", "PDV22-06", "68134", undefined])
      expect(isAbroadCountryCode(id)).toBe(false);
  });
});
