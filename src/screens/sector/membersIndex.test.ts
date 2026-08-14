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

  it("keeps a member with no awarder page OUT of the index — rule 1", () => {
    // The rule above was stated in this header and asserted nowhere: the
    // existing `href` test only checks the link's SHAPE, not that its
    // destination is servable, which is how a dead-end row shipped. Търговище is
    // the live case — a БУЛСТАТ body with zero contracts either side, so
    // `institution_identity()` is NULL and /awarder/125043455 renders "Няма
    // фирма с ЕИК … в базата.".
    const idx = buildMembersIndex(
      [
        ...members,
        {
          eik: "125043455",
          name: {
            bg: "Областна администрация — област Търговище",
            en: "Областна администрация — област Търговище",
          },
          noAwarderPage: true,
        },
      ],
      true,
    );
    expect(searchIndex(idx, "търговище")).toEqual([]);
    // …and it did not take the rest of the roster with it.
    expect(searchIndex(idx, "варна")).toHaveLength(2);
  });

  it("still lists that member in the awarders tile — the roster is the point", () => {
    // The tile reads `config.members` directly rather than the index, so
    // excluding a row from SEARCH must not remove it from the ROSTER. That
    // separation is the whole reason the flag lives on the member instead of
    // the row being deleted (НФЦ precedent, CultureSearchBox).
    expect(SECTOR_DASHBOARDS.regional.members.map((m) => m.eik)).toContain(
      "125043455",
    );
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
    // security / regional / environment / transport, plus energy — which joined
    // at exactly the floor when ДП РАО took it from 9 members to 10. Social (6)
    // is below it; the eight single-member sectors are far below.
    expect(above).toEqual(
      ["energy", "environment", "regional", "security", "transport"].sort(),
    );
  });

  // ⚠ This USED to assert "not knife-edge — any value in [10,11] picks the same
  // four". That stopped being true the moment energy landed on 10: the floor now
  // decides whether energy gets a box, so [10,11] no longer agree. Rather than
  // widen the range until it passes again (which would assert nothing), it now
  // pins the two things that are actually load-bearing — energy sits ON the
  // floor, and the floor is nowhere near the single-member sectors, which is the
  // margin that makes 10 a judgement call rather than a coin flip.
  it("puts energy exactly on the floor, and never a single-member sector", () => {
    const pick = (min: number) =>
      Object.values(SECTOR_DASHBOARDS)
        .filter((c) => c.members.length >= min)
        .map((c) => c.id)
        .sort();

    expect(pick(MEMBER_SEARCH_MIN)).toContain("energy");
    expect(pick(MEMBER_SEARCH_MIN + 1)).not.toContain("energy");

    // The durable invariant: a one-member sector is 9 clear of the floor, so no
    // plausible retune of this number mounts a search box over a single chip.
    const singles = Object.values(SECTOR_DASHBOARDS)
      .filter((c) => c.members.length === 1)
      .map((c) => c.id);
    expect(singles.length).toBeGreaterThan(0); // else the guard is vacuous
    for (const min of [
      MEMBER_SEARCH_MIN - 1,
      MEMBER_SEARCH_MIN,
      MEMBER_SEARCH_MIN + 1,
    ]) {
      for (const id of singles) expect(pick(min)).not.toContain(id);
    }
  });
});
