// Which officials get a static page — and the invariant that the sitemap and
// the prerenderer must agree on it.
//
// A <loc> whose page was never built is a soft-404. Both callers go through
// `officialsForStaticPages`, so the parity is structural; these tests pin the
// selection RULE, which is the part that can silently regress.

import { describe, expect, it } from "vitest";
import type { OfficialCategoryKind } from "@/data/dataTypes";
import {
  OFFICIALS_STATIC_PAGE_LIMIT,
  OFFICIAL_CATEGORY_LABELS,
  OFFICIAL_CATEGORY_ORDER,
  OFFICIAL_PRERENDER_PRIORITY,
  officialsForStaticPages,
} from "./officialCategoryLabels";

const official = (
  slug: string,
  category: OfficialCategoryKind,
  netWorthEur: number,
) => ({ slug, category, netWorthEur });

describe("officialsForStaticPages", () => {
  // The regression this exists for: ranking purely by net worth put 608
  // state-enterprise managers ahead of the cabinet and dropped 55% of ministers
  // out of both the prerendered set and the sitemap.
  it("puts a public office ahead of a richer operational one", () => {
    const picked = officialsForStaticPages(
      [
        official("rich-manager", "state_enterprise", 5_000_000),
        official("poor-minister", "cabinet", 1_000),
      ],
      1,
    );
    expect(picked.map((o) => o.slug)).toEqual(["poor-minister"]);
  });

  it("ranks by declared wealth inside the same tier", () => {
    const picked = officialsForStaticPages(
      [
        official("lean", "cabinet", 1_000),
        official("wealthy", "cabinet", 900_000),
      ],
      2,
    );
    expect(picked.map((o) => o.slug)).toEqual(["wealthy", "lean"]);
  });

  it("honours the limit", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      official(`o${i}`, "cabinet", i),
    );
    expect(officialsForStaticPages(many, 10)).toHaveLength(10);
  });

  it("does not mutate its input", () => {
    const input = [
      official("a", "state_enterprise", 10),
      official("b", "cabinet", 1),
    ];
    const before = input.map((o) => o.slug);
    officialsForStaticPages(input, 2);
    expect(input.map((o) => o.slug)).toEqual(before);
  });

  // The budget has to actually fit every priority-tier official, or the rule
  // silently degrades back into a wealth ranking for the tail of them.
  it("has a limit large enough for the whole priority set", () => {
    // 3,791 priority-tier officials in the current register.
    expect(OFFICIALS_STATIC_PAGE_LIMIT).toBeGreaterThanOrEqual(3791);
  });
});

describe("category vocabulary", () => {
  it("labels and orders every category exactly once", () => {
    expect(new Set(OFFICIAL_CATEGORY_ORDER).size).toBe(
      OFFICIAL_CATEGORY_ORDER.length,
    );
    for (const k of OFFICIAL_CATEGORY_ORDER) {
      expect(OFFICIAL_CATEGORY_LABELS[k]).toBeDefined();
      expect(OFFICIAL_CATEGORY_LABELS[k].bg).not.toEqual("");
      expect(OFFICIAL_CATEGORY_LABELS[k].en).not.toEqual("");
    }
  });

  it("only prioritises categories that exist", () => {
    for (const k of OFFICIAL_PRERENDER_PRIORITY) {
      expect(OFFICIAL_CATEGORY_ORDER).toContain(k);
    }
  });

  // The operational bulk is deliberately NOT prioritised — it is 10,699 of the
  // 14,490 officials and would swamp the budget.
  it("leaves the operational bulk out of the priority set", () => {
    for (const k of [
      "state_enterprise",
      "hospital_head",
      "procurement_officer",
      "eu_funds_controller",
      "regional_director",
    ] as OfficialCategoryKind[]) {
      expect(OFFICIAL_PRERENDER_PRIORITY.has(k)).toBe(false);
    }
  });
});
