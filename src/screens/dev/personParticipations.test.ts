// The fold exists to stop one company's procurement money being printed twice, so the
// first test here is the one that matters: two roles at one company must yield ONE row
// carrying that company's value ONCE. Summing is the obvious implementation and is
// exactly the defect — `person_roles` repeats a per-company total on every role row.
//
// Measured 2026-08-25: 393,411 (person, company) pairs over 293,040 people carry both an
// ownership and a management role, so this is the majority shape, not an edge case.

import { describe, it, expect } from "vitest";
import {
  foldParticipations,
  participationTag,
  type ParticipationRole,
} from "./personParticipations";

const t = (k: string): string =>
  ({
    tr_role_partner: "съдружник",
    tr_role_manager: "управител",
    tr_role_sole_owner: "едноличен собственик",
  })[k] ?? k;

const role = (over: Partial<ParticipationRole> = {}): ParticipationRole => ({
  uic: "123456789",
  company: "АКМЕ ООД",
  status: null,
  role: "partner",
  share: "50",
  added_at: "2020-01-01",
  erased_at: null,
  active: true,
  contracts: "2",
  contracts_eur: 1000,
  ...over,
});

describe("foldParticipations", () => {
  it("prints one company's value ONCE across two roles", () => {
    // The whole point. `person_roles` gives both rows the same per-company total, so a
    // `+=` here would publish €2,000 for a company that won €1,000.
    const rows = foldParticipations([
      role({ role: "sole_owner", share: "100" }),
      role({ role: "manager", share: null }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].contractsEur).toBe(1000);
    expect(rows[0].merged).toBe(true);
    expect(rows[0].roles).toHaveLength(2);
  });

  it("keeps separate companies separate", () => {
    const rows = foldParticipations([
      role({ uic: "1", company: "А", contracts_eur: 10 }),
      role({ uic: "2", company: "Б", contracts_eur: 20 }),
    ]);
    expect(rows.map((r) => r.uic)).toEqual(["1", "2"]);
    expect(rows.map((r) => r.contractsEur)).toEqual([10, 20]);
    expect(rows.every((r) => !r.merged)).toBe(true);
  });

  it("preserves the query's ordering by first appearance", () => {
    // `person_roles` orders `active DESC, added_at DESC NULLS LAST, company`. Re-sorting
    // here would put this module in the business of deciding an order SQL already
    // decided, and the two would drift.
    const rows = foldParticipations([
      role({ uic: "3", company: "В" }),
      role({ uic: "1", company: "А" }),
      role({ uic: "3", company: "В", role: "manager" }),
      role({ uic: "2", company: "Б" }),
    ]);
    expect(rows.map((r) => r.uic)).toEqual(["3", "1", "2"]);
  });

  it("stays ACTIVE when any single role is current — in the query's OWN row order", () => {
    // ⚠️ ROW ORDER IS THE WHOLE TEST. `person_roles` ends `ORDER BY active DESC, …`, so
    // the ACTIVE role arrives FIRST. With the ended role first, a last-wins fold
    // (`found.active = r.active`) also yields true and the assertion cannot tell the two
    // apart — mutation-verified: that mutation passed 16/16 before this case existed. In
    // production order last-wins yields FALSE, dimming a sitting manager as „бивш".
    const rows = foldParticipations([
      role({ role: "manager", active: true, erased_at: null }),
      role({ role: "partner", active: false, erased_at: "2022-05-05" }),
    ]);
    expect(rows[0].active).toBe(true);
  });

  it("stays ACTIVE with the ended role first too", () => {
    // The mirror, so neither order can regress alone.
    const rows = foldParticipations([
      role({ role: "partner", active: false, erased_at: "2022-05-05" }),
      role({ role: "manager", active: true, erased_at: null }),
    ]);
    expect(rows[0].active).toBe(true);
  });

  it("carries each role's OWN end date, not just the row's", () => {
    // The row is active (the manager is sitting) while the ownership has ended. Without
    // a per-role date the renderer cannot mark the ended tag, and an ended съдружник is
    // drawn as a live one — overstating a named individual's current holding. Measured
    // 2026-08-25: 58,771 pairs over 47,876 people are in this shape.
    const rows = foldParticipations([
      role({ role: "manager", active: true, erased_at: null }),
      role({ role: "partner", active: false, erased_at: "2021-09-02" }),
    ]);
    expect(rows[0].active).toBe(true);
    const partner = rows[0].roles.find((r) => r.role === "partner");
    expect(partner?.active).toBe(false);
    expect(partner?.erasedAt).toBe("2021-09-02");
    expect(
      rows[0].roles.find((r) => r.role === "manager")?.erasedAt,
    ).toBeNull();
  });

  it("is FORMER only when every role has ended, and takes the latest end", () => {
    const rows = foldParticipations([
      role({ role: "partner", active: false, erased_at: "2021-01-01" }),
      role({ role: "manager", active: false, erased_at: "2023-07-07" }),
    ]);
    expect(rows[0].active).toBe(false);
    expect(rows[0].erasedAt).toBe("2023-07-07");
  });

  it("takes the EARLIEST start — when involvement began, not when the current title did", () => {
    const rows = foldParticipations([
      role({ role: "manager", added_at: "2023-01-01" }),
      role({ role: "partner", added_at: "2015-06-01" }),
    ]);
    expect(rows[0].addedAt).toBe("2015-06-01");
  });

  it("survives a null date on either side without losing the other", () => {
    const rows = foldParticipations([
      role({ role: "manager", added_at: null }),
      role({ role: "partner", added_at: "2015-06-01" }),
    ]);
    expect(rows[0].addedAt).toBe("2015-06-01");
  });

  it("orders ownership tags before management ones", () => {
    const rows = foldParticipations([
      role({ role: "manager", share: null }),
      role({ role: "partner", share: "50" }),
    ]);
    expect(rows[0].roles.map((r) => r.role)).toEqual(["partner", "manager"]);
  });

  it("keeps a company name that only one arm carried", () => {
    // tr_companies has no row for some uics, so `company` is NULL on whichever role row
    // the join missed. Letting row order decide would blank a name we hold.
    const rows = foldParticipations([
      role({ company: null }),
      role({ role: "manager", company: "АКМЕ ООД" }),
    ]);
    expect(rows[0].company).toBe("АКМЕ ООД");
  });

  it("does not let a zero-value row blank a company's total", () => {
    const rows = foldParticipations([
      role({ contracts_eur: 0 }),
      role({ role: "manager", contracts_eur: 5000 }),
    ]);
    expect(rows[0].contractsEur).toBe(5000);
  });

  it("returns nothing for no roles", () => {
    expect(foldParticipations([])).toEqual([]);
  });
});

describe("participationTag", () => {
  it("appends the share to an ownership role", () => {
    expect(participationTag({ role: "partner", share: "16" }, t)).toBe(
      "съдружник 16%",
    );
  });

  it("omits the share on a management role, where it does not apply", () => {
    expect(participationTag({ role: "manager", share: null }, t)).toBe(
      "управител",
    );
  });

  it("drops an unanswerable share rather than printing an em dash", () => {
    // formatOwnerShare returns "—" for tr_owner_share's documented NULL — "we cannot
    // express this as a fraction of current capital". „съдружник —" reads as a missing
    // value on a row that has one; the role alone is the honest rendering.
    expect(participationTag({ role: "sole_owner", share: null }, t)).toBe(
      "едноличен собственик",
    );
  });

  it("keeps a real ZERO share, which is an answer", () => {
    // 0 is "owns nothing and we know it"; NULL is "no answer". They must not collapse.
    expect(participationTag({ role: "partner", share: 0 }, t)).toBe(
      "съдружник 0%",
    );
  });

  it("falls back to the raw code for an unknown role", () => {
    expect(participationTag({ role: "liquidator", share: null }, t)).toBe(
      "liquidator",
    );
  });
});
