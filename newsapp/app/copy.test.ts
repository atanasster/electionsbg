import { describe, expect, it } from "vitest";
import {
  bgAnalyzedArticles,
  bgArticles,
  bgCollectedArticles,
  bgMedia,
  bgStories,
  outletScopeLabel,
  outletTierLabel,
  outletTypeLabel,
} from "./labels";

describe("Bulgarian product copy", () => {
  it("translates controlled outlet metadata without inventing unknown values", () => {
    for (const value of ["editorial", "long_tail", "mass"])
      expect(outletTierLabel(value)).not.toBe("неуточнена група");
    for (const value of [
      "TV news",
      "agency",
      "aggregator",
      "analysis/culture",
      "business",
      "business TV",
      "business monthly",
      "business/markets",
      "commentary",
      "daily",
      "human rights/social",
      "independent commentary",
      "independent news",
      "regional",
      "investigative",
      "investigative/data",
      "municipal governance",
      "news",
      "news/lifestyle",
      "newspaper",
      "portal+news",
      "public TV news",
      "public radio news",
      "public-service intl",
      "radio news",
      "regional newspaper",
      "state news agency",
      "tabloid news",
      "tabloid newspaper",
      "weekly newspaper",
      "weekly/business",
    ])
      expect(outletTypeLabel(value)).not.toBe("неуточнен тип");
    for (const value of [
      "national",
      "Blagoevgrad",
      "Burgas",
      "Haskovo",
      "Plovdiv",
      "Varna",
    ])
      expect(outletScopeLabel(value)).not.toBe("неуточнен обхват");
    expect(outletTypeLabel("future_value")).toBe("неуточнен тип");
    expect(outletTypeLabel(null)).toBeNull();
  });

  it.each([
    [
      bgArticles,
      [
        "0 статии",
        "1 статия",
        "2 статии",
        "11 статии",
        "21 статии",
        "101 статии",
      ],
    ],
    [
      bgStories,
      [
        "0 истории",
        "1 история",
        "2 истории",
        "11 истории",
        "21 истории",
        "101 истории",
      ],
    ],
    [
      bgMedia,
      ["0 медии", "1 медия", "2 медии", "11 медии", "21 медии", "101 медии"],
    ],
    [
      bgAnalyzedArticles,
      [
        "0 анализирани статии",
        "1 анализирана статия",
        "2 анализирани статии",
        "11 анализирани статии",
        "21 анализирани статии",
        "101 анализирани статии",
      ],
    ],
    [
      bgCollectedArticles,
      [
        "0 събрани статии",
        "1 събрана статия",
        "2 събрани статии",
        "11 събрани статии",
        "21 събрани статии",
        "101 събрани статии",
      ],
    ],
  ] as const)("agrees dynamic counts", (formatter, expected) => {
    expect([0, 1, 2, 11, 21, 101].map((n) => formatter(n))).toEqual(expected);
  });
});
