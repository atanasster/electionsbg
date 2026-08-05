// The members index, and the two rules a roster search has to obey.
//
// 1. EVERY row must land. A member with no awarder page is a search result that
//    goes nowhere — the plan's §9.1 rule applies per ROW, not only per group.
//    НФЦ is the live case: a Bulstat entity with zero procurement footprint,
//    so /awarder/000695833 renders "Няма фирма с ЕИК … в базата."
// 2. The threshold must select the sectors it claims to.

import { describe, expect, it } from "vitest";
import { buildMembersIndex, MEMBER_SEARCH_MIN } from "./membersIndex";
import { searchIndex } from "@/lib/entitySearchIndex";
import { SECTOR_DASHBOARDS } from "./sectorDashboards";

describe("buildMembersIndex", () => {
  const members = [
    {
      eik: "129009750",
      name: { bg: "ОДМВР — Варна", en: "ОДМВР — Varna" },
      group: { bg: "Полиция", en: "Police" },
    },
    {
      eik: "129010730",
      name: { bg: "РДПБЗН — Варна", en: "РДПБЗН — Varna" },
      group: { bg: "Пожарна", en: "Fire" },
    },
  ];

  it("matches on the name, the acronym inside it, the branch and the EIK", () => {
    const idx = buildMembersIndex(members, true);
    expect(searchIndex(idx, "варна")).toHaveLength(2);
    expect(searchIndex(idx, "одмвр")[0].label).toBe("ОДМВР — Варна");
    expect(searchIndex(idx, "полиция")[0].label).toBe("ОДМВР — Варна");
    expect(searchIndex(idx, "129010730")[0].label).toBe("РДПБЗН — Варна");
  });

  it("accepts shliokavitsa", () => {
    const idx = buildMembersIndex(members, true);
    expect(searchIndex(idx, "varna")).toHaveLength(2);
  });

  it("links every row to its awarder page", () => {
    const idx = buildMembersIndex(members, true);
    for (const r of idx.rows) expect(r.href).toBe(`/awarder/${r.id}`);
  });

  it("renders the reader's language", () => {
    expect(buildMembersIndex(members, false).rows[0].label).toBe(
      "ОДМВР — Varna",
    );
  });
});

describe("MEMBER_SEARCH_MIN", () => {
  it("selects exactly the group sectors, and no single-member one", () => {
    const above = Object.values(SECTOR_DASHBOARDS)
      .filter((c) => c.members.length >= MEMBER_SEARCH_MIN)
      .map((c) => c.id)
      .sort();
    // security / regional / environment / transport. Energy (9) and social (6)
    // are below it; the eight single-member sectors are far below.
    expect(above).toEqual(
      ["environment", "regional", "security", "transport"].sort(),
    );
  });

  it("is not knife-edge — any value in [10,11] picks the same four", () => {
    const pick = (min: number) =>
      Object.values(SECTOR_DASHBOARDS)
        .filter((c) => c.members.length >= min)
        .map((c) => c.id)
        .sort()
        .join(",");
    expect(pick(10)).toBe(pick(11));
  });
});
