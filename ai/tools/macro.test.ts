// Alias-resolution tests for the macro tool's free-text → indicator-key map.
//
// resolveMacroKey scans MACRO_ALIASES with Object.entries and returns the FIRST
// substring hit, so the map's INSERTION ORDER is behaviour, not style: a
// multi-word key inserted after a shorter key it contains is dead. Nothing
// about that is visible at the call site, and the failure is silent — an
// unresolved key falls back to "gdpGrowth", so a productivity question is
// answered with a GDP-growth chart at no error.

import { describe, it, expect } from "vitest";
import { MACRO_ALIASES, resolveMacroKey } from "./macro";

describe("resolveMacroKey", () => {
  it.each([
    ["производителност", "labourProductivity"],
    ["productivity", "labourProductivity"],
    ["каква е производителността на труда", "labourProductivity"],
    ["единица продукция", "unitLabourCost"],
    ["unit labour cost", "unitLabourCost"],
    ["разходи за труд на единица продукция", "unitLabourCost"],
    ["ценово равнище", "priceIndex"],
    ["price level", "priceIndex"],
  ])("%s resolves to %s", (query, key) => {
    expect(resolveMacroKey(query)).toBe(key);
  });

  describe("longest-match ordering", () => {
    // Each pair is a query whose ANSWER differs from the answer for a shorter
    // key it contains. These are exactly the pairs a careless insertion breaks.
    it.each([
      ["фонд работна заплата", "labourIncome", "заплат"],
      ["доход от труд", "labourIncome", "доход"],
      ["разходи за труд на единица продукция", "unitLabourCost", "разходи"],
      ["корупционен индекс", "cpi", "корупц"],
    ])("%s → %s despite containing a shorter key", (query, key) => {
      expect(resolveMacroKey(query)).toBe(key);
    });

    it("keeps every multi-word alias ahead of the keys it contains", () => {
      // The general rule, enforced over the whole map rather than the four
      // cases above — so a future insertion is caught wherever it lands.
      const keys = Object.keys(MACRO_ALIASES);
      const violations: string[] = [];
      keys.forEach((long, i) => {
        keys.slice(0, i).forEach((short) => {
          if (
            long !== short &&
            long.includes(short) &&
            MACRO_ALIASES[long] !== MACRO_ALIASES[short]
          ) {
            violations.push(
              `"${long}" → ${MACRO_ALIASES[long]} is unreachable: ` +
                `"${short}" → ${MACRO_ALIASES[short]} precedes it and matches first`,
            );
          }
        });
      });
      expect(violations).toEqual([]);
    });
  });

  describe("pay: per-head level vs the nominal aggregate", () => {
    it("routes a bare wage question to compensationPerEmployee", () => {
      // labourIncome is compensation of employees in TOTAL — a headcount rise
      // reads there as a pay rise, and it is nominal. Neither is what someone
      // asking "каква е средната заплата" means.
      expect(resolveMacroKey("средна заплата")).toBe("compensationPerEmployee");
      expect(resolveMacroKey("wage")).toBe("compensationPerEmployee");
    });

    it("keeps the aggregate reachable when it is asked for by name", () => {
      expect(resolveMacroKey("фонд работна заплата")).toBe("labourIncome");
      expect(resolveMacroKey("compensation of employees")).toBe("labourIncome");
    });
  });

  it("does not answer a price question with the corruption index", () => {
    // macro.json's `cpi` is Transparency International's CORRUPTION
    // Perceptions Index. "цени" pointed at it until priceIndex existed.
    expect(resolveMacroKey("цени")).toBe("priceIndex");
    expect(resolveMacroKey("cpi")).toBe("cpi");
    // The WGI dimension keeps the plain corruption question.
    expect(resolveMacroKey("корупция")).toBe("wgiControlOfCorruption");
  });

  it("leaves the pre-existing precedence rules intact", () => {
    expect(resolveMacroKey("касов дефицит")).toBe("cashBalance");
    expect(resolveMacroKey("просрочени задължения")).toBe("arrears");
    expect(resolveMacroKey("дефицит")).toBe("budgetBalance");
    expect(resolveMacroKey("разходи")).toBe("govExpenditure");
    expect(resolveMacroKey("инфлация")).toBe("inflation");
  });

  it("returns undefined for an unknown term rather than guessing", () => {
    expect(resolveMacroKey("нещо съвсем друго")).toBeUndefined();
  });
});
