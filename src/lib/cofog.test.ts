// The COFOG code set lives in TypeScript; the NAMES live in the i18n bundles as
// `cofog_GF01` … `cofog_GF10`. This file holds that split in place, because the
// first draft of the module duplicated the names here and immediately drifted
// from the bundles on two of the ten — with the sibling tile rendering the
// other spelling one click away.

import { describe, it, expect } from "vitest";
import bg from "@/locales/bg/translation.json";
import en from "@/locales/en/translation.json";
import { COFOG_CODES, COFOG_TOTAL_CODE, cofogLabelKey } from "./cofog";

describe("COFOG codes", () => {
  it("is the ten divisions, in order, with no duplicates", () => {
    expect(COFOG_CODES).toHaveLength(10);
    expect([...COFOG_CODES]).toEqual(
      Array.from(
        { length: 10 },
        (_, i) => `GF${String(i + 1).padStart(2, "0")}`,
      ),
    );
  });

  it("does not treat the TOTAL row as a division", () => {
    // It is 100% of itself; listed among the ten, every share halves.
    expect([...COFOG_CODES]).not.toContain(COFOG_TOTAL_CODE);
    expect(cofogLabelKey(COFOG_TOTAL_CODE)).toBeNull();
  });

  it("every code has a name in BOTH bundles", () => {
    // A missing key is not a blank: i18next renders the key itself, so the page
    // would show „cofog_GF08".
    for (const code of COFOG_CODES) {
      const key = cofogLabelKey(code)!;
      expect(key).toBe(`cofog_${code}`);
      expect((bg as Record<string, string>)[key]).toBeTruthy();
      expect((en as Record<string, string>)[key]).toBeTruthy();
    }
  });

  it("returns null for an unknown code rather than an unresolvable key", () => {
    expect(cofogLabelKey("GF99")).toBeNull();
    expect(cofogLabelKey("")).toBeNull();
  });

  it("keeps the Bulgarian names Bulgarian and the English ones English", () => {
    for (const code of COFOG_CODES) {
      const key = cofogLabelKey(code)!;
      expect((bg as Record<string, string>)[key]).toMatch(/[Ѐ-ӿ]/);
      expect((en as Record<string, string>)[key]).not.toMatch(/[Ѐ-ӿ]/);
    }
  });
});
